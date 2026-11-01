import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase, prog } from './supabase.js'

const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/* ---------- formatação ---------- */
const parts = (s) => (s ? String(s).slice(0, 10).split('-').map(Number) : null)
const fmtD = (s) => { const p = parts(s); return p ? String(p[2]).padStart(2, '0') + '/' + String(p[1]).padStart(2, '0') : '—' }
const hhmm = (s) => (s ? String(s).slice(0, 5) : '—')
const num = (v, d = 0) => (v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }))
const weekday = (s) => { const p = parts(s); return WD[new Date(p[0], p[1] - 1, p[2]).getDay()] }
const fmtH = (v) => num(v, 1)

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

  const carregar = useCallback(async () => {
    const [f, o] = await Promise.all([
      prog().from('fila_calculada').select('*').order('ordem'),
      prog().from('ocupacao_dia').select('*').order('data'),
    ])
    if (f.error) { setErro(f.error.message); return }
    setErro(null)
    setRows(f.data)
    const m = {}
    ;(o.data || []).forEach((d) => { m[d.data] = d })
    setOcup(m)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function salvar(id, patch) {
    const { error } = await prog().from('fila_linha').update(patch).eq('id', id)
    if (error) setErro('Não foi possível salvar: ' + error.message)
    await carregar()
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function aoSoltar({ active, over }) {
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

  const resumo = useMemo(() => {
    if (!rows) return ''
    const ops = rows.filter((r) => r.tipo === 'op')
    const datas = ops.map((r) => r.data_producao).filter(Boolean).sort()
    const manuais = rows.filter((r) => r.tipo === 'manual').length
    const faixa = datas.length ? fmtD(datas[0]) + ' a ' + fmtD(datas[datas.length - 1]) + ' · ' : ''
    return faixa + ops.length + ' itens · ' + manuais + ' linhas manuais' + (ehController ? ' · arraste pelo ícone da esquerda para reordenar' : '')
  }, [rows, ehController])

  // monta a lista com cabeçalhos de dia
  const itens = useMemo(() => {
    if (!rows) return []
    const out = []
    let cur = '#'
    const semData = rows.filter((r) => r.tipo === 'op' && !r.data_producao)
    rows.forEach((r) => {
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
  }, [rows, ocup])

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
          {ehController && <button className="btn" onClick={() => setShowNew(!showNew)}>+ Linha manual</button>}
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

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={aoSoltar}>
            <SortableContext items={(rows || []).map((r) => r.id)} strategy={verticalListSortingStrategy}>
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
                    <Sortable key={it.r.id} id={it.r.id} disabled={!ehController} className="seprow">
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
                    <Sortable key={r.id} id={r.id} disabled={!ehController} className="g evt">
                      {(h) => (
                        <>
                          <Grip handle={h} disabled={!ehController} />
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
                return <LinhaOp key={it.r.id} r={it.r} ehController={ehController} podeOp={podeOp} salvar={salvar} excluir={excluirOp} />
              })}
            </SortableContext>
          </DndContext>
          {rows && rows.length === 0 && <div className="loading">A fila está vazia.</div>}
        </div>
      </section>
    </>
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

export function LinhaOp({ r, ehController, podeOp, salvar, excluir }) {
  const cores = Array.isArray(r.cores) ? r.cores : []
  const slot = (n) => cores.find((c) => Number(c.posicao) === n)
  const cliOk = r.cliche_disponivel !== false
  const faltaPapel = r.status_papel === 'FALTA PAPEL'
  const mfull = r.montagem != null && r.montagem === r.qtde_cores
  const rupCls = r.data_ruptura ? (r.ruptura_alinhada ? 'rb' : 'rg') : ''
  const nomeCli = String(r.cliente ?? '').replace(/\s+/g, ' ')

  return (
    <Sortable id={r.id} disabled={!ehController} className="g orow">
      {(h) => (
        <>
          <Grip handle={h} disabled={!ehController} />
          <div className="c s2 mono">
            <TextEdit className="mono" value={r.op} placeholder="nº OP" label="Número da OP gerada no SAP" disabled={!ehController} onSave={(v) => salvar(r.id, { op: v })} />
          </div>
          <div className="c s3 mono" style={{ fontWeight: 600, gap: 0, paddingLeft: 3, paddingRight: 3 }}>
            {excluir && ehController && <button className="xbtn" style={{ color: '#B42318', padding: '0 3px 0 0' }} title="Excluir OP da Fila" aria-label={'Excluir OP ' + (r.op || r.material)} onClick={() => excluir(r)}>×</button>}
            {r.material}
          </div>
          <div className="c s4"><span className="clamp" title={nomeCli}>{nomeCli}</span></div>
          <div className="c mono">{r.sku_bobina ?? '—'}</div>
          <div className="c mono">{r.sku_cliche ?? '—'}</div>
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
              <span className="an-tag" title={`Alinhado em ${fmtD(r.alinhado_em)}${r.alinhado_por ? ' por ' + r.alinhado_por : ''}${r.alinhado_com ? ' com ' + r.alinhado_com : ''}`}>alinhado</span>
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
