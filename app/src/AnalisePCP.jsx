import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTempoReal, TR } from './tempoReal.js'
import { supabase, prog } from './supabase.js'

const motor = () => supabase.schema('motor')
const cad = () => supabase.schema('cadastro')

// status que pedem ação do PCP
const AV = ['AVALIAR', 'ALINHADO SEM REGISTRO', 'ALINHADO · BI MUDOU', 'SEM DATA']
// ordem de avaliação (de cima para baixo): programar → ajustar data → ajustar quantidade → OK
const ORD_DATA = ['AVALIAR', 'SEM DATA', 'ALINHADO · BI MUDOU', 'ALINHADO SEM REGISTRO']
const ORD_QTD = ['ABAIXO', 'DIFERENÇA', 'FILA ALTERADA', 'ACIMA', 'PROGRAMADO SEM NECESSIDADE']
const ORD_ACAO = ['PRODUZIR URGENTE', 'PROGRAMAR', 'AJUSTAR QTD', 'PROGRAMADO', 'OK', 'SUPER ESTOQUE']
const posX = (lista, v) => { const i = lista.indexOf(v); return i < 0 ? lista.length : i }
const rankMto = (x) => {
  if (x.status_qtd === 'CADASTRAR BOBINA KIWI') return [0, 0]
  if (x.status_qtd === 'NÃO PROGRAMADO') return [1, 0]
  if (ORD_DATA.includes(x.status_data)) return [2, ORD_DATA.indexOf(x.status_data)]
  if (ORD_QTD.includes(x.status_qtd)) return [3, ORD_QTD.indexOf(x.status_qtd)]
  return [4, 0]
}
// MTS: 1º cliente, 2º ação (PRODUZIR URGENTE, PROGRAMAR, AJUSTAR QTD, PROGRAMADO, OK, SUPER ESTOQUE), 3º status da quantidade, 4º contrato
const ORD_STATUS_MTS = ['NÃO PROGRAMADO', 'ABAIXO', 'DIFERENÇA', 'FILA ALTERADA', 'ACIMA', 'PROGRAMADO SEM NECESSIDADE', 'OK']
const cmpRank = (ra, rb) => ra[0] - rb[0] || ra[1] - rb[1]
const QD = ['ACIMA', 'ABAIXO', 'DIFERENÇA', 'FILA ALTERADA', 'PROGRAMADO SEM NECESSIDADE']

/* ---------- formatação ---------- */
const fmtD = (s) => (s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) + '/' + String(s).slice(0, 4) : '—')
const fmtN = (n) => (n == null ? '—' : (Math.round(Number(n)) || 0).toLocaleString('pt-BR'))
const fmtP = (n) => (Math.round(Number(n) * 10) / 10).toLocaleString('pt-BR')
const minus3 = (s) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 3); return d.toISOString().slice(0, 10) }
const limpa = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

const TOM = {
  ok: 'b-ok',
  warn: 'b-warn',
  err: 'b-err',
  info: 'b-info',
}
const tomData = (s) => (s === 'OK' || s === 'OK (ALINHADO)' ? 'ok' : s === 'AVALIAR' ? 'err' : 'warn')
const tomQtd = (s) => (s === 'OK' ? 'ok' : s === 'NÃO PROGRAMADO' ? 'info' : s === 'CADASTRAR BOBINA KIWI' ? 'err' : 'warn')
const tomAcao = (s) => (s === 'PRODUZIR URGENTE' ? 'err' : s === 'PROGRAMAR' ? 'info' : s === 'AJUSTAR QTD' ? 'warn' : s === 'PROGRAMADO' || s === 'OK' ? 'ok' : 'info')

function deltaTxt(r) {
  if (r.delta_m == null) return '—'
  const d = Number(r.delta_m)
  const sd = Math.round(d) > 0 ? '+' : ''
  let t = sd + fmtN(d)
  if (r.delta_pct != null) t += ` (${Number(r.delta_pct) > 0 ? '+' : ''}${fmtP(r.delta_pct)}%)`
  return t
}

/* ---------- tela ---------- */
export default function AnalisePCP({ perfil }) {
  const ehController = perfil === 'controller'
  const [aba, setAba] = useState('mto')
  const [mto, setMto] = useState(null)
  const [mts, setMts] = useState(null)
  const [erro, setErro] = useState(null)
  const [okMsg, setOkMsg] = useState(null)
  const [ajustando, setAjustando] = useState(null)
  const [confirmando, setConfirmando] = useState(null)
  const [filtro, setFiltro] = useState('todos')
  const [q, setQ] = useState('')
  const [aberto, setAberto] = useState(null)
  const [pct, setPct] = useState('0')
  const [enviando, setEnviando] = useState(false)

  const carregar = useCallback(async () => {
    const [a, b] = await Promise.all([
      motor().from('analise_mto').select('*'),
      motor().from('analise_mts').select('*'),
    ])
    if (a.error || b.error) { setErro((a.error || b.error).message); return }
    setErro(null)
    setMto(a.data)
    setMts(b.data)
  }, [])
  useEffect(() => { carregar() }, [carregar])
  // Tempo real: novo envio de dados, item programado na Fila, cadastros ou contratos alterados por qualquer usuário
  useTempoReal([TR.carga, ...TR.fila, ...TR.combos, ...TR.contratos], carregar)

  const trocaAba = (n) => { setAba(n); setFiltro('todos'); setAberto(null); setPct('0') }
  const abre = (chave) => { setAberto((x) => (x === chave ? null : chave)); setPct('0') }

  async function programar(tipo, chave, rotulo) {
    const p = parseFloat(String(pct).replace(',', '.'))
    if (Number.isNaN(p) || p < 0 || p > 100) { setErro('Acréscimo deve estar entre 0 e 100.'); return }
    setEnviando(true); setErro(null); setOkMsg(null)
    const { error } = await prog().rpc('programar_item', { p_tipo: tipo, p_chave: String(chave), p_percentual: p })
    setEnviando(false)
    if (error) { setErro('Não foi possível programar: ' + error.message); return }
    setOkMsg(`${rotulo} programado no fim da Fila${p > 0 ? ` com acréscimo de ${fmtP(p)}%` : ''}. Complete OP, data de produção e bobinas na Fila.`)
    setAberto(null); setPct('0')
    await carregar()
  }

  async function ajustar(tipo, chave, rotulo) {
    setAjustando(String(chave)); setErro(null); setOkMsg(null)
    const { data, error } = await prog().rpc('ajustar_qtd', { p_tipo: tipo, p_chave: String(chave) })
    setAjustando(null)
    if (error) { setErro('Não foi possível ajustar: ' + error.message); return }
    let m = `${rotulo}: M. Mínima na Fila ajustada de ${fmtN(data?.total_antes)} para ${fmtN(data?.total_depois)} m.`
    if (data?.linhas > 1) m += ` Produção dividida em ${data.linhas} linhas: ajustadas na mesma proporção.`
    if (data?.bobinas_manuais > 0) m += ' As bobinas digitadas à mão foram mantidas: confira na Fila.'
    setOkMsg(m)
    await carregar()
  }

  async function cancelarOp(tipo, chave, rotulo) {
    setAjustando(String(chave)); setErro(null); setOkMsg(null)
    const { data, error } = await prog().rpc('cancelar_op', { p_tipo: tipo, p_chave: String(chave) })
    setAjustando(null); setConfirmando(null)
    if (error) { setErro('Não foi possível cancelar a OP: ' + error.message); return }
    setOkMsg(`${rotulo}: OP cancelada. ${data?.linhas} linha(s) removida(s) da Fila (${fmtN(data?.total_cancelado)} m).`)
    await carregar()
  }

  /* ----- MTO ----- */
  const linhasMto = useMemo(() => {
    if (!mto) return []
    const t = q.trim().toLowerCase()
    return mto
      .filter((x) => {
        if (filtro === 'np' && x.status_qtd !== 'NÃO PROGRAMADO') return false
        if (filtro === 'qtd' && !QD.includes(x.status_qtd)) return false
        if (filtro === 'data' && !(x.status_data && AV.includes(x.status_data))) return false
        if (t && (x.material + ' ' + (x.material_descricao || '') + ' ' + (x.cliente || '')).toLowerCase().indexOf(t) < 0) return false
        return true
      })
      .sort((a, b) => cmpRank(rankMto(a), rankMto(b))
        || String(a.data_critica_real || '9999').localeCompare(String(b.data_critica_real || '9999'))
        || a.material.localeCompare(b.material))
  }, [mto, filtro, q])

  const kpiMto = useMemo(() => {
    const l = mto || []
    return {
      total: l.length,
      np: l.filter((x) => x.status_qtd === 'NÃO PROGRAMADO').length,
      qtd: l.filter((x) => QD.includes(x.status_qtd)).length,
      data: l.filter((x) => x.status_data && AV.includes(x.status_data)).length,
      ok: l.filter((x) => x.status_qtd === 'OK' && (x.status_data === 'OK' || x.status_data === 'OK (ALINHADO)')).length,
    }
  }, [mto])

  /* ----- MTS ----- */
  const linhasMts = useMemo(() => {
    if (!mts) return []
    const t = q.trim().toLowerCase()
    return mts
      .filter((x) => {
        if (filtro === 'np' && x.status_qtd !== 'NÃO PROGRAMADO') return false
        if (filtro === 'qtd' && !QD.includes(x.status_qtd)) return false
        if (filtro === 'sup' && x.acao !== 'SUPER ESTOQUE') return false
        if (t && (x.codigo + ' ' + (x.material_descricao || x.descricao || '') + ' ' + (x.cliente || '') + ' ' + (x.sku_caixa || '')).toLowerCase().indexOf(t) < 0) return false
        return true
      })
      .sort((a, b) => String(a.cliente || '\uffff').localeCompare(String(b.cliente || '\uffff'), 'pt-BR')
        || posX(ORD_ACAO, a.acao) - posX(ORD_ACAO, b.acao)
        || posX(ORD_STATUS_MTS, a.status_qtd) - posX(ORD_STATUS_MTS, b.status_qtd)
        || a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
  }, [mts, filtro, q])

  const kpiMts = useMemo(() => {
    const l = mts || []
    const c = (a) => l.filter((x) => x.acao === a).length
    return {
      total: l.length,
      prod: c('PRODUZIR URGENTE'),
      ress: c('PROGRAMAR'),
      sup: c('SUPER ESTOQUE'),
      np: l.filter((x) => x.status_qtd === 'NÃO PROGRAMADO').length,
      qtd: l.filter((x) => QD.includes(x.status_qtd)).length,
    }
  }, [mts])

  const chips = aba === 'mto'
    ? [['todos', 'Todos', kpiMto.total], ['np', 'Não programados', kpiMto.np], ['qtd', 'Quantidade diferente', kpiMto.qtd], ['data', 'Data a avaliar', kpiMto.data]]
    : [['todos', 'Todos', kpiMts.total], ['np', 'Não programados', kpiMts.np], ['qtd', 'Quantidade diferente', kpiMts.qtd], ['sup', 'Super estoque', kpiMts.sup]]

  if (!mto && !mts && !erro) return <div className="loading">Carregando análise…</div>

  const linhas = aba === 'mto' ? linhasMto : linhasMts

  return (
    <div className="ap-page">
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.3px' }}>Análise PCP</h1>
          <div style={{ fontSize: 13, color: '#5A6675', marginTop: 2 }}>
            {aba === 'mto'
              ? 'O que precisa ser produzido, comparado com o que está programado na Fila.'
              : 'Contratos ativos: estoque, pedidos e o que está programado na Fila.'}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }} role="group" aria-label="Aba da análise">
            <button className={'ap-tab' + (aba === 'mto' ? ' on' : '')} aria-pressed={aba === 'mto'} onClick={() => trocaAba('mto')}>MTO</button>
            <button className={'ap-tab' + (aba === 'mts' ? ' on' : '')} aria-pressed={aba === 'mts'} onClick={() => trocaAba('mts')}>MTS</button>
          </div>
        </div>
      </header>

      {erro && <div className="msg err" role="alert">{erro} <button className="linkbtn" onClick={() => setErro(null)}>fechar</button></div>}
      {okMsg && <div className="msg ok" role="status">{okMsg} <button className="linkbtn" onClick={() => setOkMsg(null)}>fechar</button></div>}

      <section aria-label="Resumo" className="ap-kpis">
        {aba === 'mto' ? (
          <>
            <Kpi n={kpiMto.total} t="Materiais com falta" />
            <Kpi n={kpiMto.np} t="Não programados" tom="info" />
            <Kpi n={kpiMto.qtd} t="Quantidade diferente" tom="warn" />
            <Kpi n={kpiMto.data} t="Data a avaliar / registrar" tom="warn" />
            <Kpi n={kpiMto.ok} t="Programados e OK" tom="ok" />
          </>
        ) : (
          <>
            <Kpi n={kpiMts.total} t="Contratos ativos" />
            <Kpi n={kpiMts.prod} t="Produzir urgente" tom="err" />
            <Kpi n={kpiMts.ress} t="Programar" tom="info" />
            <Kpi n={kpiMts.sup} t="Super estoque" tom="info" />
            <Kpi n={kpiMts.np} t="Não programados" tom="info" />
            <Kpi n={kpiMts.qtd} t="Quantidade diferente" tom="warn" />
          </>
        )}
      </section>

      <section aria-label="Legenda" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', alignItems: 'center', fontSize: 12, color: '#3B4756' }}>
        <span><span className="badge b-ok">OK</span> <span className="ap-tag">acréscimo 10%</span> necessidade igual à registrada ao programar</span>
        <span><span className="badge b-warn">DIFERENÇA</span> a necessidade mudou desde que foi programado</span>
        <span><span className="badge b-warn">FILA ALTERADA</span> a Fila deixou de ser necessidade + acréscimo</span>
        {aba === 'mto' && <span><span className="rg">Data ruptura</span> verde: ruptura −3 dias · <span className="rb">preto</span>: alinhada</span>}
      </section>

      <section aria-label="Filtros" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chips.map(([id, rot, n]) => (
            <button key={id} className={'ap-chip' + (filtro === id ? ' on' : '')} aria-pressed={filtro === id} onClick={() => { setFiltro(id); setAberto(null) }}>{rot} ({n})</button>
          ))}
        </div>
        <label className="fld">Buscar
          <input type="search" placeholder={aba === 'mto' ? 'Material ou cliente' : 'Contrato, cliente ou SKU'} style={{ width: 260, maxWidth: '100%' }} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </section>

      {aba === 'mto' ? (
        <TabelaMto linhas={linhas} ehController={ehController} aberto={aberto} abre={abre} pct={pct} setPct={setPct} enviando={enviando} programar={programar} ajustar={ajustar} ajustando={ajustando} />
      ) : (
        <TabelaMts linhas={linhas} ehController={ehController} aberto={aberto} abre={abre} pct={pct} setPct={setPct} enviando={enviando} programar={programar} ajustar={ajustar} ajustando={ajustando} cancelarOp={cancelarOp} confirmando={confirmando} setConfirmando={setConfirmando} />
      )}

      <div style={{ fontSize: 12, color: '#5A6675', lineHeight: 1.5 }}>
        {aba === 'mto'
          ? 'Produzir = necessidade pelo racional do SEQUENCIAMENTO (janela de 45 dias). Na Fila = soma da M. Mínima das linhas do material. Para registrar o alinhamento de uma data, use a coluna Data ruptura na Fila.'
          : 'Estoque projetado = Estoque − o maior entre os pedidos até a data e a média (M.L. contrato ÷ 90 × dias). Sem OP: Programar quando o projetado em D+25 ≤ estoque de segurança (média × 25 dias × 30%); Produzir = M.L. contrato − projetado. Com OP: compara a Fila com M.L. contrato − projetado na data da OP. Produzir urgente: Estoque < Pedido, com a quantidade pela regra do MTO (janela de 45 dias). Super estoque: Estoque − Pedido > M.L. contrato × 1,1. MTS não tem status de data.'}
      </div>
    </div>
  )
}

function Kpi({ n, t, tom }) {
  return (
    <div className={'ap-kpi' + (tom ? ' ' + tom : '')}>
      <b>{n}</b>
      <span>{t}</span>
    </div>
  )
}

/** Mostra a combinação (bobina + clichê) que o Programar vai usar: a última usada. Se houver outras, um alerta discreto. */
function CombinacaoAviso({ material }) {
  const [combos, setCombos] = useState(null)
  const [aberta, setAberta] = useState(false)
  useEffect(() => {
    let vivo = true
    setCombos(null); setAberta(false)
    if (!material) return undefined
    cad().from('combinacao_v').select('*').eq('material', material).eq('ativo', true)
      .order('ultimo_uso', { ascending: false, nullsFirst: false }).order('usos', { ascending: false })
      .then(({ data }) => { if (vivo) setCombos(data || []) })
    return () => { vivo = false }
  }, [material])
  if (combos === null) return <span style={{ color: '#5A6675', fontSize: 12.5 }}>Verificando bobina e clichê…</span>
  if (!combos.length) return <span className="ap-alerta">Material sem combinação bobina + clichê cadastrada: a linha entra sem clichê. Cadastre em Cadastros.</span>
  const [usada, ...outras] = combos
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5 }}>
      <span>
        <b>Será usado:</b> bobina <span className="mono">{usada.sku_bobina}</span> · clichê <span className="mono">{usada.sku_cliche}</span>
        {usada.rotulo ? ` (${limpa(usada.rotulo)})` : ''} · último uso {fmtD(usada.ultimo_uso)}
      </span>
      {outras.length > 0 && (
        <span className="ap-alerta">
          ⚠ Este material tem mais {outras.length} {outras.length === 1 ? 'combinação' : 'combinações'} cadastrada{outras.length === 1 ? '' : 's'}.{' '}
          <button className="linkbtn" onClick={() => setAberta((v) => !v)}>{aberta ? 'ocultar' : 'ver'}</button>
          {aberta && (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {outras.map((c) => (
                <li key={c.id ?? c.sku_bobina + c.sku_cliche}>
                  bobina <span className="mono">{c.sku_bobina}</span> · clichê <span className="mono">{c.sku_cliche}</span>
                  {c.rotulo ? ` (${limpa(c.rotulo)})` : ''} · último uso {fmtD(c.ultimo_uso)} · {c.usos} uso{Number(c.usos) === 1 ? '' : 's'}
                </li>
              ))}
            </ul>
          )}
        </span>
      )}
    </div>
  )
}

function Painel({ aberto, material, pct, setPct, previa, detalhe, enviando, onProgramar, onCancelar }) {
  if (!aberto) return null
  return (
    <div className="ap-painel">
      <label className="fld">Acréscimo (%)
        <input type="number" min="0" max="100" step="any" value={pct} style={{ width: 96 }} onChange={(e) => setPct(e.target.value)} />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13, flex: '1 1 320px' }}>
        <span>{previa}</span>
        <span style={{ color: '#5A6675' }}>{detalhe}</span>
        <CombinacaoAviso material={material} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" disabled={enviando} onClick={onProgramar}>{enviando ? 'Programando…' : 'Programar na Fila'}</button>
        <button className="btn" disabled={enviando} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

function TabelaMto({ linhas, ehController, aberto, abre, pct, setPct, enviando, programar, ajustar, ajustando }) {
  const p = parseFloat(String(pct).replace(',', '.')) || 0
  return (
    <section aria-label="Materiais com falta (MTO)" className="ap-wrap">
      <div className="ap-t" role="table">
        <div className="ap-r ap-mto ap-h" role="row">
          {['Material', 'Cliente', 'Data crítica (BI)'].map((h) => <div key={h} className="ap-c" role="columnheader">{h}</div>)}
          <div className="ap-c ap-n" role="columnheader">Produzir (m)</div>
          <div className="ap-c ap-n" role="columnheader">Na Fila (m)</div>
          <div className="ap-c ap-n" role="columnheader">Diferença</div>
          {['Ruptura Fila', 'Status data', 'Status qtd'].map((h) => <div key={h} className="ap-c" role="columnheader">{h}</div>)}
          <div className="ap-c" role="columnheader"><span className="sr">Ação</span></div>
        </div>
        {linhas.map((x) => {
          const sdTom = x.status_data ? TOM[tomData(x.status_data)] : ''
          const sqTom = TOM[tomQtd(x.status_qtd)]
          const dl = x.delta_m == null ? null : Math.round(Number(x.delta_m))
          const abre1 = aberto === x.material
          const total = Math.ceil(Number(x.produzir_m) * (1 + p / 100))
          return (
            <div key={x.material}>
              <div className="ap-r ap-mto ap-b" role="row">
                <div className="ap-c mono" style={{ fontWeight: 500 }}>{x.material}</div>
                <div className="ap-c" title={limpa(x.material_descricao) || ''} style={{ color: x.material_descricao ? '#1B2430' : '#5A6675' }}><span className="ap-cli">{limpa(x.material_descricao) || 'Sem cadastro de material'}</span></div>
                <div className="ap-c mono">{fmtD(x.data_critica_real)}</div>
                <div className="ap-c ap-n mono" style={{ fontWeight: 500 }}>{fmtN(x.produzir_m)}</div>
                <div className="ap-c ap-n mono">{fmtN(x.programado_m)}</div>
                <div className="ap-c ap-n mono" style={{ color: dl == null || dl === 0 ? '#1B2430' : '#74460A', textAlign: 'right' }}>{deltaTxt(x)}</div>
                <div className="ap-c mono" style={{ fontWeight: x.ruptura_alinhada ? 700 : 600, color: !x.data_ruptura_fila ? '#5A6675' : x.ruptura_alinhada ? '#1B2430' : '#0F7A3E' }}>{fmtD(x.data_ruptura_fila)}</div>
                <div className="ap-c" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, justifyContent: 'center' }}>
                  {x.status_data && (
                    <>
                      <span className={'badge ' + sdTom}>{x.status_data}</span>
                      {x.status_data === 'ALINHADO · BI MUDOU' && x.bi_no_alinhamento && (
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#74460A' }} title="Data crítica do BI no momento do alinhamento → data crítica atual">BI mudou: {fmtD(x.bi_no_alinhamento).slice(0, 5)} → {fmtD(x.data_critica_real).slice(0, 5)}</span>
                      )}
                      {x.dif_dias != null && <span style={{ fontSize: 12.5, color: '#5A6675' }}>BI − Fila: {x.dif_dias > 0 ? '+' : ''}{x.dif_dias} d</span>}
                    </>
                  )}
                </div>
                <div className="ap-c" style={{ flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 3 }}>
                  {x.status_qtd && <span className={'badge ' + sqTom}>{x.status_qtd}</span>}
                  {x.refugo_pct != null && Number(x.refugo_pct) > 0 && <span className="ap-tag" title={`Necessidade base ${fmtN(x.refugo_base_m)} m`}>acréscimo {fmtP(x.refugo_pct)}%</span>}
                </div>
                <div className="ap-c">
                  {ehController && x.status_qtd === 'NÃO PROGRAMADO' && (
                    <button className="btn sm primary" aria-expanded={abre1} onClick={() => abre(x.material)}>Programar</button>
                  )}
                  {ehController && (x.status_qtd === 'ACIMA' || x.status_qtd === 'ABAIXO') && (
                    <button className="btn sm" disabled={ajustando === String(x.material)} title={`Muda a M. Mínima na Fila para ${fmtN(x.produzir_m)} m (o PRODUZIR)`} onClick={() => ajustar('mto', x.material, 'Material ' + x.material)}>{ajustando === String(x.material) ? 'Ajustando…' : 'Ajustar qtd'}</button>
                  )}
                </div>
              </div>
              <Painel
                aberto={abre1}
                material={x.material}
                pct={pct}
                setPct={setPct}
                enviando={enviando}
                previa={`M. Mínima na Fila: ${fmtN(x.produzir_m)} m + ${fmtP(p)}% = ${fmtN(total)} m`}
                detalhe={`Data de ruptura na Fila = data crítica − 3 dias = ${fmtD(x.data_critica_real ? minus3(x.data_critica_real) : null)}. OP, data de produção, bobinas e horário você completa na Fila.`}
                onProgramar={() => programar('mto', x.material, 'Material ' + x.material)}
                onCancelar={() => abre(x.material)}
              />
            </div>
          )
        })}
        {!linhas.length && <div className="loading">Nada encontrado para esse filtro.</div>}
      </div>
    </section>
  )
}

function TabelaMts({ linhas, ehController, aberto, abre, pct, setPct, enviando, programar, ajustar, ajustando, cancelarOp, confirmando, setConfirmando }) {
  const p = parseFloat(String(pct).replace(',', '.')) || 0
  return (
    <section aria-label="Contratos (MTS)" className="ap-wrap">
      <div className="ap-t mts" role="table">
        <div className="ap-r ap-mts ap-h" role="row">
          {['Contrato', 'Cliente', 'Planta', 'SKU caixa'].map((h) => <div key={h} className="ap-c" role="columnheader">{h}</div>)}
          {['M.L. contrato', 'Pedido (m)', 'Estoque (m)'].map((h) => <div key={h} className="ap-c ap-n" role="columnheader">{h}</div>)}
          <div className="ap-c" role="columnheader">Ação</div>
          {['Produzir (m)', 'Na Fila (m)', 'Diferença'].map((h) => <div key={h} className="ap-c ap-n" role="columnheader">{h}</div>)}
          <div className="ap-c" role="columnheader">Status qtd</div>
          <div className="ap-c" role="columnheader"><span className="sr">Programar</span></div>
        </div>
        {linhas.map((x) => {
          const dl = x.delta_m == null ? null : Math.round(Number(x.delta_m))
          const abre1 = aberto === String(x.contrato_id)
          const total = Math.ceil(Number(x.produzir_m) * (1 + p / 100))
          return (
            <div key={x.contrato_id}>
              <div className="ap-r ap-mts ap-b" role="row">
                <div className="ap-c mono" style={{ fontWeight: 500 }}>{x.codigo}</div>
                <div className="ap-c" title={limpa(x.material_descricao || x.descricao) || ''}><span className="ap-cli">{limpa(x.material_descricao || x.descricao) || '—'}</span></div>
                <div className="ap-c">{x.planta ?? '—'}</div>
                <div className="ap-c mono">{x.sku_caixa ?? '—'}</div>
                <div className="ap-c ap-n mono">{fmtN(x.ml_contrato)}</div>
                <div className="ap-c ap-n mono">{fmtN(x.pedido_m)}</div>
                <div className="ap-c ap-n mono">{fmtN(x.estoque_m)}</div>
                <div className="ap-c ap-acao" style={{ flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 3 }}>
                  <span className={'badge ' + TOM[tomAcao(x.acao)]}>{x.acao}</span>
                  {x.passa_100_contrato && <span className="ap-tag" style={{ color: '#74460A', fontWeight: 600, borderColor: '#E0B060' }} title={`Estoque ${fmtN(x.estoque_m)} m + produção ${fmtN(Number(x.programado_m) > 0 ? x.programado_m : x.produzir_m)} m = ${fmtN(Number(x.estoque_m) + Number(Number(x.programado_m) > 0 ? x.programado_m : x.produzir_m))} m, acima do M.L. do contrato (${fmtN(x.ml_contrato)} m)`}>passa de 100%</span>}
                </div>
                <div className="ap-c ap-n mono" style={{ fontWeight: 500 }} title={x.urgente ? `Regra do MTO: falta a partir de ${fmtD(x.data_critica_mto)}, janela de 45 dias` : `Estoque projetado em ${fmtD(x.data_ref)}: ${fmtN(x.estoque_projetado_m)} m (estoque − o maior entre pedidos e média). Estoque de segurança: ${fmtN(x.es_m)} m`}>{fmtN(x.produzir_m)}</div>
                <div className="ap-c ap-n mono">{fmtN(x.programado_m)}</div>
                <div className="ap-c ap-n mono" style={{ color: dl == null || dl === 0 ? '#1B2430' : '#74460A', textAlign: 'right' }}>{deltaTxt(x)}</div>
                <div className="ap-c" style={{ flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 3 }}>
                  {x.status_qtd && <span className={'badge ' + TOM[tomQtd(x.status_qtd)]}>{x.status_qtd}</span>}
                  {x.refugo_pct != null && Number(x.refugo_pct) > 0 && <span className="ap-tag" title={`Necessidade base ${fmtN(x.refugo_base_m)} m`}>acréscimo {fmtP(x.refugo_pct)}%</span>}
                </div>
                <div className="ap-c">
                  {ehController && x.status_qtd === 'NÃO PROGRAMADO' && (
                    <button className="btn sm primary" aria-expanded={abre1} onClick={() => abre(String(x.contrato_id))}>Programar</button>
                  )}
                  {ehController && (x.status_qtd === 'ACIMA' || x.status_qtd === 'ABAIXO') && (
                    <button className="btn sm" disabled={ajustando === String(x.contrato_id)} title={`Muda a M. Mínima na Fila para ${fmtN(x.produzir_m)} m (o PRODUZIR)`} onClick={() => ajustar('mts', x.contrato_id, 'Contrato ' + x.codigo)}>{ajustando === String(x.contrato_id) ? 'Ajustando…' : 'Ajustar qtd'}</button>
                  )}
                  {ehController && x.status_qtd === 'PROGRAMADO SEM NECESSIDADE' && (
                    confirmando === String(x.contrato_id) ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <button className="btn sm danger" disabled={ajustando === String(x.contrato_id)} onClick={() => cancelarOp('mts', x.contrato_id, 'Contrato ' + x.codigo)}>{ajustando === String(x.contrato_id) ? 'Cancelando…' : 'Confirmar'}</button>
                        <button className="btn sm" onClick={() => setConfirmando(null)}>Voltar</button>
                      </div>
                    ) : (
                      <button className="btn sm" title={`Remove da Fila as ${x.linhas_fila} linha(s) deste contrato (${fmtN(x.programado_m)} m)`} onClick={() => setConfirmando(String(x.contrato_id))}>Cancelar OP</button>
                    )
                  )}
                </div>
              </div>
              <Painel
                aberto={abre1}
                material={x.sku_caixa}
                pct={pct}
                setPct={setPct}
                enviando={enviando}
                previa={`M. Mínima na Fila: ${fmtN(x.produzir_m)} m + ${fmtP(p)}% = ${fmtN(total)} m`}
                detalhe={`Contrato ${x.codigo} · SKU da caixa ${x.sku_caixa}. OP, data de produção, bobinas e horário você completa na Fila.`}
                onProgramar={() => programar('mts', x.contrato_id, 'Contrato ' + x.codigo)}
                onCancelar={() => abre(String(x.contrato_id))}
              />
            </div>
          )
        })}
        {!linhas.length && <div className="loading">Nada encontrado para esse filtro.</div>}
      </div>
    </section>
  )
}
