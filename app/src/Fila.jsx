import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTempoReal, TR } from './tempoReal.js'
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase, prog } from './supabase.js'
import ItemProducao from './ItemProducao.jsx'

const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/* ---------- formatação ---------- */
const parts = (s) => (s ? String(s).slice(0, 10).split('-').map(Number) : null)
const fmtD = (s) => { const p = parts(s); return p ? String(p[2]).padStart(2, '0') + '/' + String(p[1]).padStart(2, '0') : '—' }
const hhmm = (s) => (s ? String(s).slice(0, 5) : '—')
const num = (v, d = 0) => (v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }))
const weekday = (s) => { const p = parts(s); return WD[new Date(p[0], p[1] - 1, p[2]).getDay()] }
const fmtH = (v) => num(v, 1)
const norm = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

function Sortable({ id, disabled, className, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  const style = { transform: CSS.Transform.toString(transform), transition }
  return (
    <div ref={setNodeRef} style={style} className={className + (isDragging ? ' dragging' : '')} role="row">
      {children(disabled ? {} : { ...attributes, ...listeners })}
    </div>
  )
}

function Grip({ handle, disabled }) {
  return (
    <div className="c s1" style={{ padding: '5px 4px', justifyContent: 'center', cursor: disabled ? 'default' : 'grab', touchAction: 'none' }} {...handle} aria-label="Arrastar para reordenar">
      {!disabled && (
        <svg width="12" height="18" viewBox="0 0 14 20" style={{ color: '#7A8594', flex: 'none' }}>
          {[4, 10, 16].flatMap((y) => [4, 10].map((x) => <circle key={x + '-' + y} cx={x} cy={y} r="1.7" fill="currentColor" />))}
        </svg>
      )}
    </div>
  )
}

/* ---------- campos editáveis ---------- */
function TextEdit({ value, onSave, disabled, className = '', placeholder, label, ...rest }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => setV(value ?? ''), [value])
  return (
    <input
      className={'opin ' + className}
      value={v}
      placeholder={placeholder}
      aria-label={label}
      title={v}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if ((v || null) !== (value || null)) onSave(v.trim() || null) }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      {...rest}
    />
  )
}

function NumEdit({ value, onSave, disabled, min = 0, label }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => setV(value ?? ''), [value])
  return (
    <input
      className="opin num mono"
      type="number"
      min={min}
      value={v}
      aria-label={label}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { const n = v === '' ? null : Number(v); if (n !== (value ?? null)) onSave(n) }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

/* ---------- tela ---------- */
export default function Fila({ perfil }) {
  const ehController = perfil === 'controller'
  const ehOperacao = perfil === 'operacao'
  const podeOp = ehController || ehOperacao // montagem, faca, pit stop

  const [rows, setRows] = useState(null)
  const [ocup, setOcup] = useState({})
  const [erro, setErro] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [novo, setNovo] = useState({ data: '', ini: '', fim: '', desc: '' })
  const hoje = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const [showHist, setShowHist] = useState(false)
  const [diasSel, setDiasSel] = useState([])
  const [okMsg, setOkMsg] = useState(null)
  const [salvandoHist, setSalvandoHist] = useState(false)
  const [alinhar, setAlinhar] = useState(null) // linha cuja data de ruptura está sendo alinhada
  const [trocar, setTrocar] = useState(null) // linha cuja bobina/clichê está sendo trocada
  const [showItem, setShowItem] = useState(false)
  const [busca, setBusca] = useState('') // material, OP, cliente, SKU ou dd/mm
  const [dataFiltro, setDataFiltro] = useState('') // dia (yyyy-mm-dd)

  const carregar = useCallback(async () => {
    const [f, o, ob] = await Promise.all([
      prog().from('fila_calculada').select('*').order('ordem'),
      prog().from('ocupacao_dia').select('*').order('data'),
      supabase.schema('cadastro').from('cliche_vigente').select('sku_cliche').eq('status', 'obsoleto'),
    ])
    if (f.error) { setErro(f.error.message); return }
    setErro(null)
    const obsoletos = new Set((ob.data || []).map((c) => c.sku_cliche))
    setRows(f.data.map((r) => (r.sku_cliche && obsoletos.has(r.sku_cliche) ? { ...r, cliche_obsoleto: true } : r)))
    const m = {}
    ;(o.data || []).forEach((d) => { m[d.data] = d })
    setOcup(m)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  // Tempo real: qualquer mudança de outro usuário atualiza a Fila. Durante um arraste (ou o salvamento da própria
  // reordenação) a recarga espera, para a linha não "pular" da mão de quem está movendo.
  const ocupado = useRef(false)
  const pendente = useRef(false)
  const aoMudar = useCallback(() => { if (ocupado.current) pendente.current = true; else carregar() }, [carregar])
  const liberar = () => { ocupado.current = false; if (pendente.current) { pendente.current = false; carregar() } }
  useTempoReal([TR.carga, ...TR.fila, 'cadastro.cliche', 'cadastro.material', 'cadastro.cliente', 'acompanhamento.fila_snapshot'], aoMudar)

  async function salvar(id, patch) {
    const { error } = await prog().from('fila_linha').update(patch).eq('id', id)
    if (error) setErro('Não foi possível salvar: ' + error.message)
    await carregar()
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function aoSoltar(e) {
    ocupado.current = true
    try { await soltarLinha(e) } finally { liberar() }
  }

  async function soltarLinha({ active, over }) {
    if (!over || active.id === over.id || !ehController) return
    const de = rows.findIndex((r) => r.id === active.id)
    const para = rows.findIndex((r) => r.id === over.id)
    const novaOrdem = arrayMove(rows, de, para)
    setRows(novaOrdem) // otimista
    const { error } = await prog().rpc('reordenar_fila', { p_ids: novaOrdem.map((r) => r.id) })
    if (error) { setErro('Não foi possível reordenar: ' + error.message); await carregar(); return }
    // a linha movida assume a data de produção da vizinha (o dia é definido pela posição)
    const movida = novaOrdem[para]
    if (movida.tipo === 'op') {
      const ok = (r) => r && r.tipo !== 'separador'
      let viz = null
      for (let i = para - 1; i >= 0 && !viz; i--) if (ok(novaOrdem[i])) viz = novaOrdem[i]
      for (let i = para + 1; i < novaOrdem.length && !viz; i++) if (ok(novaOrdem[i])) viz = novaOrdem[i]
      if (viz && (viz.data_producao ?? null) !== (movida.data_producao ?? null)) {
        await prog().from('fila_linha').update({ data_producao: viz.data_producao ?? null }).eq('id', movida.id)
      }
    }
    await carregar()
  }

  async function inserirManual(e) {
    e.preventDefault()
    const m = novo.data.match(/^(\d{1,2})\/(\d{1,2})$/)
    if (!m) { setErro('Data no formato dd/mm'); return }
    const ano = new Date().getFullYear()
    const iso = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    const { error } = await prog().rpc('inserir_linha_manual', {
      p_data: iso, p_descricao: novo.desc.trim(), p_inicio: novo.ini || null, p_fim: novo.fim || null,
    })
    if (error) { setErro('Não foi possível inserir: ' + error.message); return }
    setNovo({ data: '', ini: '', fim: '', desc: '' }); setShowNew(false)
    await carregar()
  }

  async function excluirOp(r) {
    const nome = [r.op && 'OP ' + r.op, r.material, r.data_producao && fmtD(r.data_producao)].filter(Boolean).join(' · ')
    if (!window.confirm(`Excluir da Fila a linha ${nome}?\n\nEla NÃO vai para o Histórico.`)) return
    const { error } = await prog().from('fila_linha').delete().eq('id', r.id)
    if (error) setErro('Não foi possível excluir: ' + error.message)
    await carregar()
  }

  async function excluirManual(r) {
    if (!window.confirm(`Excluir a linha "${r.descricao}" (${fmtD(r.data_producao)})?`)) return
    const { error } = await prog().from('fila_linha').delete().eq('id', r.id)
    if (error) setErro('Não foi possível excluir: ' + error.message)
    await carregar()
  }

  // dias que existem na fila (OP e linhas manuais com Data Produção)
  const diasFila = useMemo(() => {
    const m = new Map()
    ;(rows || []).forEach((r) => {
      if ((r.tipo === 'op' || r.tipo === 'manual') && r.data_producao) m.set(r.data_producao, (m.get(r.data_producao) || 0) + 1)
    })
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([data, n]) => ({ data, n }))
  }, [rows])
  const totalSel = diasFila.filter((d) => diasSel.includes(d.data)).reduce((t, d) => t + d.n, 0)
  const alternaDia = (d) => setDiasSel((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]))

  async function salvarNoHistorico() {
    const dias = diasFila.filter((d) => diasSel.includes(d.data)).map((d) => d.data)
    if (!dias.length) return
    setErro(null); setOkMsg(null)
    const lista = dias.map((d) => fmtD(d) + '/' + d.slice(0, 4)).join(', ')
    if (!window.confirm(`Salvar no Histórico e REMOVER da Fila ${totalSel} linha(s) de ${dias.length} dia(s)?\n\n${lista}`)) return
    setSalvandoHist(true)
    const { data, error } = await supabase.schema('acompanhamento').rpc('salvar_historico_dias', { p_dias: dias, p_observacao: null })
    setSalvandoHist(false)
    if (error) { setErro(error.message); return }
    setOkMsg(`${data.dias.length} dia(s) salvos no Histórico; ${data.removidas_da_fila} linha(s) removidas da Fila.`)
    setDiasSel([]); setShowHist(false)
    carregar()
  }

  const filtrando = busca.trim() !== '' || dataFiltro !== ''
  const rowsVis = useMemo(() => {
    if (!rows) return null
    if (!filtrando) return rows
    const termos = norm(busca).split(' ').filter(Boolean)
    return rows.filter((r) => {
      if (r.tipo === 'separador') return false
      if (dataFiltro && r.data_producao !== dataFiltro) return false
      if (!termos.length) return true
      const palheiro = norm([r.material, r.op, r.cliente, r.rotulo, r.material_descricao, r.descricao, r.sku_cliche, r.sku_bobina, r.observacoes,
        r.data_producao && fmtD(r.data_producao), r.data_producao && fmtD(r.data_producao) + '/' + String(r.data_producao).slice(0, 4)].filter(Boolean).join(' '))
      return termos.every((t) => palheiro.includes(t))
    })
  }, [rows, busca, dataFiltro, filtrando])

  const resumo = useMemo(() => {
    if (!rows) return ''
    if (filtrando) {
      const n = rowsVis.filter((r) => r.tipo === 'op').length
      return `Filtro ativo · ${n} de ${rows.filter((r) => r.tipo === 'op').length} itens · arrastar desativado enquanto filtra`
    }
    const ops = rows.filter((r) => r.tipo === 'op')
    const datas = ops.map((r) => r.data_producao).filter(Boolean).sort()
    const manuais = rows.filter((r) => r.tipo === 'manual').length
    const faixa = datas.length ? fmtD(datas[0]) + ' a ' + fmtD(datas[datas.length - 1]) + ' · ' : ''
    return faixa + ops.length + ' itens · ' + manuais + ' linhas manuais' + (ehController ? ' · arraste pelo ícone da esquerda para reordenar' : '')
  }, [rows, rowsVis, filtrando, ehController])

  // monta a lista com cabeçalhos de dia
  const itens = useMemo(() => {
    if (!rowsVis) return []
    const out = []
    let cur = '#'
    const semData = rowsVis.filter((r) => r.tipo === 'op' && !r.data_producao)
    rowsVis.forEach((r) => {
      if (r.tipo === 'separador') { out.push({ k: 'sep', r }); cur = '#'; return }
      if (r.tipo === 'manual') { out.push({ k: 'manual', r }); return }
      const d = r.data_producao || null
      if (d !== cur) {
        cur = d
        if (d) {
          const o = ocup[d]
          let sub = ''; let over = false
          if (o) {
            if (o.tipo_dia === 'sabado' || o.tipo_dia === 'domingo') sub = fmtH(o.horas_ocupadas) + ' h programadas'
            else {
              sub = `ocupação ${num(o.ocupacao_pct)}% · janela vaga ${fmtH(o.janela_vaga_h)} h`
              if (Number(o.sobrecarga_h) > 0) { sub += ' · SOBRECARGA'; over = true }
            }
          }
          out.push({ k: 'dia', label: weekday(d) + ' ' + fmtD(d), sub, over })
        } else {
          const h = semData.reduce((a, x) => a + Number(x.tempo_h || 0), 0)
          out.push({ k: 'dia', label: 'Sem data definida', sub: `${semData.length} itens · ${fmtH(h)} h` })
        }
      }
      out.push({ k: 'op', r })
    })
    return out
  }, [rowsVis, ocup])

  const podeArrastar = ehController && !filtrando

  if (rows === null && !erro) return <div className="loading">Carregando fila…</div>

  return (
    <>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.3px' }}>Fila de produção</h1>
          <div style={{ fontSize: 13, color: '#5A6675', marginTop: 2 }}>{resumo}</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button className="btn" onClick={carregar}>Atualizar</button>
          {ehController && <button className="btn" aria-expanded={showItem} onClick={() => setShowItem(!showItem)} title="Incluir na Fila um material que ainda não apareceu na Análise PCP">+ Item de produção</button>}
          {ehController && <button className="btn" onClick={() => setShowNew(!showNew)} title="Limpeza, manutenção, dia extra...">+ Linha manual</button>}
          {ehController && <button className="btn primary" aria-expanded={showHist} onClick={() => setShowHist(!showHist)} title="Escolher os dias que vão para o Histórico e saem da Fila">Salvar no Histórico</button>}
        </div>
      </header>

      {erro && <div className="msg err" role="alert">{erro} <button className="linkbtn" onClick={() => setErro(null)}>fechar</button></div>}
      {okMsg && <div className="msg ok" role="status">{okMsg} <button className="linkbtn" onClick={() => setOkMsg(null)}>fechar</button></div>}

      {ehController && showHist && (
        <section aria-label="Salvar no Histórico" style={{ background: '#fff', border: '1px solid #DDE1E7', borderRadius: 10, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <strong>Quais dias vão para o Histórico?</strong>
            <div style={{ fontSize: 13, color: '#5A6675' }}>As linhas dos dias marcados são guardadas no Histórico e saem da Fila.</div>
          </div>
          {!diasFila.length ? <div style={{ fontSize: 13 }}>Não há dias com Data Produção na Fila.</div> : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {diasFila.map((d) => (
                  <label key={d.data} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid ' + (diasSel.includes(d.data) ? '#2F6FDB' : '#C9CFD8'), background: diasSel.includes(d.data) ? '#EAF1FD' : '#fff', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={diasSel.includes(d.data)} onChange={() => alternaDia(d.data)} />
                    <span><strong>{weekday(d.data)} {fmtD(d.data)}</strong> · {d.n} linha(s){d.data === hoje ? ' · hoje' : ''}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <button type="button" className="btn" onClick={() => setDiasSel(diasFila.filter((d) => d.data <= hoje).map((d) => d.data))}>Marcar até hoje</button>
                <button type="button" className="btn" onClick={() => setDiasSel([])} disabled={!diasSel.length}>Limpar</button>
                <button type="button" className="btn primary" disabled={salvandoHist || !diasSel.length} onClick={salvarNoHistorico}>
                  {salvandoHist ? 'Salvando…' : diasSel.length ? `Salvar ${diasSel.length} dia(s) e remover da Fila (${totalSel} linhas)` : 'Marque os dias'}
                </button>
                <button type="button" className="btn" onClick={() => setShowHist(false)}>Fechar</button>
              </div>
            </>
          )}
        </section>
      )}

      {ehController && showItem && (
        <ItemProducao
          filaRows={rows || []}
          onCancel={() => setShowItem(false)}
          onIncluido={async (msg) => { setShowItem(false); setOkMsg(msg); setBusca(''); setDataFiltro(''); await carregar() }}
        />
      )}

      {showNew && (
        <form onSubmit={inserirManual} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', background: '#fff', border: '1px solid #DDE1E7', borderRadius: 10, padding: '12px 16px' }}>
          <label className="fld">Data<input required placeholder="dd/mm" style={{ width: 90 }} value={novo.data} onChange={(e) => setNovo({ ...novo, data: e.target.value })} /></label>
          <label className="fld">Início<input type="time" style={{ width: 110 }} value={novo.ini} onChange={(e) => setNovo({ ...novo, ini: e.target.value })} /></label>
          <label className="fld">Fim<input type="time" style={{ width: 110 }} value={novo.fim} onChange={(e) => setNovo({ ...novo, fim: e.target.value })} /></label>
          <label className="fld" style={{ flex: '1 1 280px' }}>Descrição<input required placeholder="Dia extra, preventivo, manutenção, limpeza..." style={{ width: '100%' }} value={novo.desc} onChange={(e) => setNovo({ ...novo, desc: e.target.value })} /></label>
          <button className="btn primary">Inserir no fim da fila</button>
          <button type="button" className="btn" onClick={() => setShowNew(false)}>Cancelar</button>
        </form>
      )}

      <section aria-label="Filtro da Fila" className="filtro-fila">
        <label className="fld" style={{ flex: '1 1 260px', maxWidth: 420 }}>Buscar por material, OP, cliente ou dd/mm
          <input type="search" placeholder="Ex.: 209831B, vulcabras, 05/11" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <label className="fld">Data de produção
          <input type="date" value={dataFiltro} onChange={(e) => setDataFiltro(e.target.value)} />
        </label>
        {filtrando && <button type="button" className="btn" onClick={() => { setBusca(''); setDataFiltro('') }}>Limpar filtro</button>}
        {filtrando && rowsVis && <span style={{ fontSize: 13, color: '#5A6675', alignSelf: 'center' }}>{rowsVis.filter((r) => r.tipo === 'op').length} item(ns) encontrado(s)</span>}
      </section>

      <section aria-label="Legenda" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', alignItems: 'center', fontSize: 12, color: '#3B4756' }}>
        <span><span className="late">Data prod.</span> (vermelho): ATRASADO</span>
        <span><span className="rg">Data ruptura</span> (verde): ruptura −3 dias</span>
        <span><span className="rb">Data ruptura</span> (preto): ruptura alinhada</span>
        <span>Clichê <span className="badge b-warn">dd/mm</span> data de chegada</span>
        <span><span style={{ display: 'inline-block', width: 22, height: 12, outline: '1px dashed #8FAEE0', verticalAlign: 'middle' }} /> Editável pela Operação</span>
        <span><span style={{ display: 'inline-block', width: 30, height: 14, border: '1px solid #C9CFD8', borderRadius: 4, verticalAlign: 'middle', background: '#fff' }} /> Editável pela Controller</span>
      </section>

      <section className="scroller" role="region" aria-label="Fila de produção" tabIndex={0}>
        <div className="tbl">
          <CabecalhoFila />

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => { ocupado.current = true }} onDragCancel={liberar} onDragEnd={aoSoltar}>
            <SortableContext items={(rowsVis || []).map((r) => r.id)} strategy={verticalListSortingStrategy}>
              {itens.map((it, i) => {
                if (it.k === 'dia') {
                  return (
                    <div className="dayrow" key={'d' + i}>
                      <div className="daylab"><strong>{it.label}</strong><span className={it.over ? 'over' : ''}>{it.sub}</span></div>
                    </div>
                  )
                }
                if (it.k === 'sep') {
                  return (
                    <Sortable key={it.r.id} id={it.r.id} disabled={!podeArrastar} className="seprow">
                      {(h) => (
                        <div className="seplab" {...(ehController ? h : {})} style={{ cursor: ehController ? 'grab' : 'default' }}>
                          BLOCO DE PENDÊNCIAS <span>acima: liberado para montagem e setup · abaixo: pendente</span>
                        </div>
                      )}
                    </Sortable>
                  )
                }
                if (it.k === 'manual') {
                  const r = it.r
                  return (
                    <Sortable key={r.id} id={r.id} disabled={!podeArrastar} className="g evt">
                      {(h) => (
                        <>
                          <Grip handle={h} disabled={!podeArrastar} />
                          <div className="c s2" style={{ gridColumn: '2 / 5', justifyContent: 'space-between' }}>
                            <span>{r.descricao}</span>
                            {ehController && <button className="xbtn" style={{ color: '#14532D' }} title="Excluir linha" onClick={() => excluirManual(r)}>×</button>}
                          </div>
                          <div className="c mono" style={{ gridColumn: 8 }}>{fmtD(r.data_producao)}</div>
                          <div className="c mono" style={{ gridColumn: 9 }}>{hhmm(r.inicio)}</div>
                        </>
                      )}
                    </Sortable>
                  )
                }
                return <LinhaOp key={it.r.id} r={it.r} ehController={ehController} semArrastar={filtrando} podeOp={podeOp} salvar={salvar} excluir={excluirOp} abrirAlinhar={ehController ? setAlinhar : undefined} abrirTrocar={ehController ? setTrocar : undefined} />
              })}
            </SortableContext>
          </DndContext>
          {rows && rows.length === 0 && <div className="loading">A fila está vazia.</div>}
        </div>
      </section>

      {alinhar && <AlinharModal r={alinhar} onFechar={() => setAlinhar(null)} onSalvo={async () => { setAlinhar(null); await carregar() }} />}
      {trocar && <TrocarCombinacaoModal r={trocar} onFechar={() => setTrocar(null)} onSalvo={async (msg) => { setTrocar(null); setOkMsg(msg); await carregar() }} />}
    </>
  )
}

/* ---------- troca de bobina e clichê de uma linha da Fila (Controller) ---------- */
function TrocarCombinacaoModal({ r, onFechar, onSalvo }) {
  const [combos, setCombos] = useState(null)
  const [sel, setSel] = useState(`${r.sku_bobina ?? ''}|${r.sku_cliche ?? ''}`)
  const [outra, setOutra] = useState({ bob: '', cli: '' })
  const [erro, setErro] = useState(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    const fechar = (e) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', fechar)
    return () => window.removeEventListener('keydown', fechar)
  }, [onFechar])

  useEffect(() => {
    let vivo = true
    supabase.schema('cadastro').from('combinacao_v').select('*').eq('material', r.material).eq('ativo', true)
      .order('ultimo_uso', { ascending: false, nullsFirst: false }).order('usos', { ascending: false })
      .then(({ data, error }) => { if (!vivo) return; if (error) setErro(error.message); setCombos(data || []) })
    return () => { vivo = false }
  }, [r.material])

  const usaOutra = sel === 'outra'
  const bob = usaOutra ? outra.bob.trim() : sel.split('|')[0]
  const cli = usaOutra ? outra.cli.trim().toUpperCase() : sel.split('|')[1]
  const igual = bob === (r.sku_bobina ?? '') && cli === (r.sku_cliche ?? '')
  const fmtD2 = (s) => (s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) + '/' + String(s).slice(2, 4) : '—')

  async function enviar(e) {
    e.preventDefault()
    setSalvando(true); setErro(null)
    const { error } = await prog().rpc('trocar_combinacao_linha', { p_id: r.id, p_sku_bobina: bob, p_sku_cliche: cli })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    const mudouCliche = cli !== (r.sku_cliche ?? '')
    onSalvo(`${r.material}: bobina ${bob} · clichê ${cli}.${mudouCliche ? ' Confira se o clichê novo está disponível: a marcação de disponibilidade da linha foi mantida.' : ''}`)
  }

  return (
    <div className="alin-bg" onClick={onFechar}>
      <form className="alin" style={{ width: 'min(680px, 94vw)', maxWidth: 'none' }} role="dialog" aria-modal="true" aria-labelledby="troc-t" onClick={(e) => e.stopPropagation()} onSubmit={enviar}>
        <div>
          <h2 id="troc-t">Trocar bobina e clichê</h2>
          <div style={{ fontSize: 13, color: '#5A6675', marginTop: 2 }}>{[r.op && 'OP ' + r.op, r.material].filter(Boolean).join(' · ')} — {String(r.material_descricao ?? '').replace(/\s+/g, ' ')}</div>
        </div>
        {erro && <div className="msg err" role="alert">{erro}</div>}
        {combos === null && !erro && <div className="sub">Carregando combinações…</div>}
        {combos && (
          <div role="radiogroup" aria-label="Combinações do material" style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '45vh', overflow: 'auto' }}>
            {combos.map((c) => {
              const v = `${c.sku_bobina}|${c.sku_cliche}`
              const atual = c.sku_bobina === r.sku_bobina && c.sku_cliche === r.sku_cliche
              return (
                <label key={v} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', border: '1px solid ' + (sel === v ? '#1F5FBF' : '#DDE1E7'), background: sel === v ? '#EEF3FB' : '#fff', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', fontSize: 13 }}>
                  <input type="radio" name="comb" checked={sel === v} onChange={() => setSel(v)} />
                  <span>Bobina <b className="mono">{c.sku_bobina}</b></span>
                  <span>Clichê <b className="mono">{c.sku_cliche}</b></span>
                  {c.papel_tipo && <span style={{ color: '#5A6675' }}>{c.papel_tipo}</span>}
                  {c.rotulo && <span style={{ color: '#5A6675' }}>{String(c.rotulo).replace(/\s+/g, ' ')}</span>}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {atual && <span className="badge b-info">ATUAL</span>}
                    {c.mais_recente && <span className="badge b-ok">MAIS RECENTE</span>}
                    {c.cliche_status === 'obsoleto' && <span className="badge b-warn">clichê obsoleto</span>}
                    {!c.cliche_cadastrado && <span className="badge b-warn">fora do catálogo</span>}
                    <span style={{ color: '#5A6675' }}>último uso {fmtD2(c.ultimo_uso)} · {c.usos} uso(s)</span>
                  </span>
                </label>
              )
            })}
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', border: '1px solid ' + (usaOutra ? '#1F5FBF' : '#DDE1E7'), background: usaOutra ? '#EEF3FB' : '#fff', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', fontSize: 13 }}>
              <input type="radio" name="comb" checked={usaOutra} onChange={() => setSel('outra')} />
              <span>Outra combinação (ainda não cadastrada)</span>
              {usaOutra && (
                <>
                  <input placeholder="SKU Bobina" style={{ width: 130 }} value={outra.bob} onChange={(e) => setOutra({ ...outra, bob: e.target.value })} autoFocus />
                  <input placeholder="SKU Clichê" style={{ width: 130 }} value={outra.cli} onChange={(e) => setOutra({ ...outra, cli: e.target.value })} />
                </>
              )}
            </label>
          </div>
        )}
        <div style={{ fontSize: 12, color: '#5A6675' }}>A linha passa a usar a bobina, o clichê, a camisa e as cores da combinação escolhida. O papel segue a combinação. A marcação de disponibilidade do clichê da linha é mantida: confira se o clichê novo está disponível.</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" disabled={salvando} onClick={onFechar}>Cancelar</button>
          <button className="btn primary" disabled={salvando || igual || !bob || !cli}>{salvando ? 'Salvando…' : 'Trocar'}</button>
        </div>
      </form>
    </div>
  )
}

/* ---------- alinhamento da data de ruptura (Controller) ---------- */
function AlinharModal({ r, onFechar, onSalvo }) {
  const hoje = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const [f, setF] = useState({ data: r.data_ruptura ?? '', em: r.alinhado_em ?? hoje, por: r.alinhado_por ?? '', com: r.alinhado_com ?? '' })
  const [erro, setErro] = useState(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    const fechar = (e) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', fechar)
    return () => window.removeEventListener('keydown', fechar)
  }, [onFechar])

  async function enviar(e) {
    e.preventDefault()
    setSalvando(true); setErro(null)
    const { error } = await prog().rpc('registrar_alinhamento', {
      p_linha_id: r.id,
      p_data_ruptura: f.data || null,
      p_alinhado_em: f.em || null,
      p_alinhado_por: f.por,
      p_alinhado_com: f.com,
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    onSalvo()
  }

  const nome = [r.op && 'OP ' + r.op, r.material].filter(Boolean).join(' · ')
  return (
    <div className="alin-bg" onClick={onFechar}>
      <form className="alin" role="dialog" aria-modal="true" aria-labelledby="alin-t" onClick={(e) => e.stopPropagation()} onSubmit={enviar}>
        <div>
          <h2 id="alin-t">Alinhar data de ruptura</h2>
          <div style={{ fontSize: 13, color: '#5A6675', marginTop: 2 }}>{nome}</div>
        </div>
        {erro && <div className="msg err" role="alert">{erro}</div>}
        <label className="fld">Data de ruptura alinhada
          <input type="date" required value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </label>
        <label className="fld">Data do alinhamento
          <input type="date" required value={f.em} onChange={(e) => setF({ ...f, em: e.target.value })} />
        </label>
        <label className="fld">Quem alinhou
          <input required placeholder="Nome de quem fez o alinhamento" value={f.por} onChange={(e) => setF({ ...f, por: e.target.value })} />
        </label>
        <label className="fld">Com quem alinhou
          <input required placeholder="CS, vendedor ou cliente" value={f.com} onChange={(e) => setF({ ...f, com: e.target.value })} />
        </label>
        <div style={{ fontSize: 12, color: '#5A6675' }}>A data fica em preto na Fila e a Análise PCP passa a conferir se o BI muda depois deste registro.</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" disabled={salvando} onClick={onFechar}>Cancelar</button>
          <button className="btn primary" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar alinhamento'}</button>
        </div>
      </form>
    </div>
  )
}

export function CabecalhoFila() {
  return (
    <>
          <div className="g band" role="row">
            <div className="c sp7"><span style={{ position: 'sticky', left: 8 }}>Identificação</span></div>
            <div className="c sp5">Programação</div>
            <div className="c sp3">Quantidade</div>
            <div className="c sp3">Papel</div>
            <div className="c sp6">Ferramental e montagem</div>
            <div className="c sp9">Cores e anilox</div>
          </div>
          <div className="g hdr" role="row">
            <div className="c s1" />
            <div className="c s2">OP</div>
            <div className="c s3">Material</div>
            <div className="c s4">Cliente</div>
            {['SKU bobina', 'SKU clichê', 'Clichê', 'Data prod.', 'Início', 'Fim', 'Data ruptura', 'Observações'].map((h) => <div key={h} className="c">{h}</div>)}
            <div className="c" style={{ justifyContent: 'flex-end', textAlign: 'right' }}>M. Linear mínima</div>
            <div className="c" style={{ justifyContent: 'flex-end' }}>Vol. M²</div>
            {['Bob.', 'Papel', 'Status papel', 'Tipo · fornecedor', 'Camisa', 'Adapt.', 'Cores', 'Montagem', 'Faca / novo', 'Pit stop'].map((h) => <div key={h} className="c">{h}</div>)}
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <div key={n} className="c">Cor {n} · anilox</div>)}
          </div>
    </>
  )
}

function DataCell({ r, editavel, onSave }) {
  const ref = React.useRef(null)
  const tip = r.atrasado ? 'Produção depois da ruptura real (' + fmtD(r.ruptura_real) + ')' : ''
  const abrir = () => { try { ref.current.showPicker() } catch { ref.current.focus() } }
  return (
    <span style={{ position: 'relative' }}>
      <span className={r.atrasado ? 'late' : ''} title={editavel ? 'Clique para alterar a data. ' + tip : tip}
        onClick={editavel ? abrir : undefined} style={editavel ? { cursor: 'pointer', textDecoration: 'underline dotted #8FAEE0' } : undefined}>
        {fmtD(r.data_producao)}
      </span>
      {editavel && (
        <input ref={ref} type="date" tabIndex={-1} aria-label="Data de produção" value={r.data_producao ?? ''}
          onChange={(e) => onSave(e.target.value || null)}
          style={{ position: 'absolute', left: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none', border: 0, padding: 0 }} />
      )}
    </span>
  )
}

export function LinhaOp({ r, ehController, podeOp, salvar, excluir, abrirAlinhar, abrirTrocar, podeExcluir, semArrastar }) {
  const cores = Array.isArray(r.cores) ? r.cores : []
  const slot = (n) => cores.find((c) => Number(c.posicao) === n)
  const cliOk = r.cliche_disponivel !== false
  const faltaPapel = r.status_papel === 'FALTA PAPEL'
  const mfull = r.montagem != null && r.montagem === r.qtde_cores
  const rupCls = r.data_ruptura ? (r.ruptura_alinhada ? 'rb' : 'rg') : ''
  // descrição completa do material (Rótulo da aba DADOS); só cai para a empresa se não houver
  const nomeCli = String(r.material_descricao ?? r.rotulo ?? r.cliente ?? '').replace(/\s+/g, ' ')

  return (
    <Sortable id={r.id} disabled={!ehController || !!semArrastar} className="g orow">
      {(h) => (
        <>
          <Grip handle={h} disabled={!ehController || !!semArrastar} />
          <div className="c s2 mono">
            <TextEdit className="mono" value={r.op} placeholder="nº OP" label="Número da OP gerada no SAP" disabled={!ehController} onSave={(v) => salvar(r.id, { op: v })} />
          </div>
          <div className="c s3 mono" style={{ fontWeight: 600, gap: 0, paddingLeft: 3, paddingRight: 3 }}>
            {excluir && (ehController || podeExcluir) && <button className="xbtn" style={{ color: '#B42318', padding: '0 3px 0 0' }} title={podeExcluir ? 'Excluir linha do Histórico' : 'Excluir OP da Fila'} aria-label={'Excluir OP ' + (r.op || r.material)} onClick={() => excluir(r)}>×</button>}
            {r.material}
          </div>
          <div className="c s4"><span title={nomeCli}>{nomeCli}</span></div>
          <div className="c mono">{abrirTrocar ? <button type="button" className="trocar" title="Trocar a bobina e o clichê desta linha" onClick={() => abrirTrocar(r)}>{r.sku_bobina ?? '—'}</button> : (r.sku_bobina ?? '—')}</div>
          <div className="c mono">{abrirTrocar ? <button type="button" className="trocar" title="Trocar a bobina e o clichê desta linha" onClick={() => abrirTrocar(r)}>{r.sku_cliche ?? '—'}</button> : (r.sku_cliche ?? '—')}{r.cliche_obsoleto && <span title="Clichê OBSOLETO: a última versão na aba DADOS está como obsoleta" aria-label="Clichê obsoleto" style={{ color: '#B45309', marginLeft: 3 }}>⚠</span>}</div>
          <div className="c edit">
            {cliOk
              ? <svg width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Clichê disponível" style={{ color: '#0F7A3E' }}><path d="M2.5 7.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              : <span className="badge b-warn" title={r.cliche_obs || ''}>{r.cliche_chegada ? fmtD(r.cliche_chegada) : '—'}</span>}
          </div>
          <div className="c mono">
            <DataCell r={r} editavel={ehController} onSave={(v) => salvar(r.id, { data_producao: v })} />
          </div>
          <div className="c mono">{hhmm(r.inicio)}</div>
          <div className="c mono">{hhmm(r.fim)}</div>
          <div className="c mono slot">
            <span className={rupCls}>{fmtD(r.data_ruptura)}</span>
            {r.data_ruptura && r.ruptura_alinhada && (
              abrirAlinhar
                ? <button type="button" className="alin-btn" title={`Alinhado em ${fmtD(r.alinhado_em)}${r.alinhado_por ? ' por ' + r.alinhado_por : ''}${r.alinhado_com ? ' com ' + r.alinhado_com : ''}. Clique para editar.`} onClick={() => abrirAlinhar(r)}>alinhado</button>
                : <span className="an-tag" title={`Alinhado em ${fmtD(r.alinhado_em)}${r.alinhado_por ? ' por ' + r.alinhado_por : ''}${r.alinhado_com ? ' com ' + r.alinhado_com : ''}`}>alinhado</span>
            )}
            {abrirAlinhar && !(r.data_ruptura && r.ruptura_alinhada) && (
              <button type="button" className="alin-btn" title="Registrar o alinhamento desta data de ruptura" onClick={() => abrirAlinhar(r)}>alinhar</button>
            )}
          </div>
          <div className="c"><TextEdit value={r.observacoes} label="Observações da OP" disabled={!ehController} onSave={(v) => salvar(r.id, { observacoes: v })} /></div>
          <div className="c mono" style={{ justifyContent: 'flex-end', fontWeight: 500 }}>{num(r.m_minima)}</div>
          <div className="c mono" style={{ justifyContent: 'flex-end' }}>{num(r.volume_m2, 1)}</div>
          <div className="c mono">{r.bobinas ?? '—'}</div>
          <div className="c mono">{r.papel_codigo ?? '—'}</div>
          <div className="c">
            {faltaPapel ? <span className="badge b-err">FALTA PAPEL</span> : <span style={{ color: '#5A6675' }}>em estoque</span>}
          </div>
          <div className="c">{[r.papel_tipo, r.papel_fornecedor].filter(Boolean).join(' - ') || '—'}</div>
          <div className="c mono">{r.camisa ?? '—'}</div>
          <div className="c">
            <div className="chip sm mono" title={'Adaptador ' + (r.adaptador ?? '')} style={{ background: r.adaptador_cor_fundo || '#EEF1F5', color: r.adaptador_cor_texto || '#1B2430', fontWeight: 600 }}>{r.adaptador ?? '—'}</div>
          </div>
          <div className="c mono">{r.qtde_cores ?? '—'}</div>
          <div className="c edit mono" style={{ gap: 3 }}>
            <NumEdit value={r.montagem} label="Montagem" disabled={!podeOp} onSave={(n) => salvar(r.id, { montagem: n })} />
            <span className={mfull ? 'mfull' : ''}>/{r.qtde_cores ?? '—'}</span>
          </div>
          <div className="c edit">
            <input type="checkbox" checked={!!r.faca_item_novo} disabled={!podeOp} aria-label="Faca / item novo" onChange={(e) => salvar(r.id, { faca_item_novo: e.target.checked })} style={{ width: 18, height: 18 }} />
          </div>
          <div className="c edit mono">
            <NumEdit value={r.pit_stop} label="Pit stop" disabled={!podeOp} onSave={(n) => salvar(r.id, { pit_stop: n ?? 0 })} />
          </div>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
            const s = slot(n)
            return (
              <div className="c" key={n}>
                {s && (
                  <div className="chip" title={s.cor + (s.anilox ? ' · anilox ' + s.anilox : '')} style={{ background: s.cor_fundo || '#EEF1F5', color: s.cor_texto || '#1B2430', boxShadow: /^#?(fff|ffffff)$/i.test(s.cor_fundo || '') ? 'inset 0 0 0 1px #C9CFD8' : undefined }}>
                    <span className="t1">{s.cor}</span>
                    <span className="t2 mono">{s.anilox}</span>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}
    </Sortable>
  )
}
