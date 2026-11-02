import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'

const motor = () => supabase.schema('motor')

const fmtD = (s) => (s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) + '/' + String(s).slice(0, 4) : '—')
const fmtN = (n) => (n == null ? '—' : (Math.round(Number(n)) || 0).toLocaleString('pt-BR'))
// minúsculas e sem acento, para a busca ignorar maiúsculas/acentos
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const plural = (n, um, varios) => `${fmtN(n)} ${Number(n) === 1 ? um : varios}`

export default function Consultar() {
  const [pedidos, setPedidos] = useState(null)
  const [estoque, setEstoque] = useState(null)
  const [erro, setErro] = useState(null)
  const [cliente, setCliente] = useState('')
  const [material, setMaterial] = useState('')

  const carregar = useCallback(async () => {
    const [a, b] = await Promise.all([
      motor().from('consultar_pedido').select('*').limit(5000),
      motor().from('consultar_estoque_material').select('*').limit(5000),
    ])
    if (a.error || b.error) { setErro((a.error || b.error).message); return }
    setErro(null)
    setPedidos(a.data)
    setEstoque(b.data)
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const clientes = useMemo(() => (pedidos ? [...new Set(pedidos.map((p) => p.cliente).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'pt-BR')) : []), [pedidos])

  const buscando = cliente.trim().length >= 2 || material.trim().length >= 2

  const linhas = useMemo(() => {
    if (!pedidos || !buscando) return []
    const c = norm(cliente)
    const m = norm(material)
    return pedidos
      .filter((p) => (!c || norm(p.cliente).includes(c)) && (!m || norm(p.material).includes(m)))
      .sort((x, y) => String(x.material).localeCompare(String(y.material)) || String(x.data_entrega ?? '').localeCompare(String(y.data_entrega ?? '')) || String(x.op).localeCompare(String(y.op)))
  }, [pedidos, cliente, material, buscando])

  const resumo = useMemo(() => {
    const r = { skus: new Set(), total: linhas.length, lib: 0, susp: 0, ond: 0, cxLib: 0, cxSusp: 0, cxOnd: 0 }
    for (const p of linhas) {
      r.skus.add(p.material)
      const cx = Number(p.caixas) || 0
      if (p.classificacao === 'JA_ONDULADA') { r.ond++; r.cxOnd += cx }
      else if (p.classificacao === 'SUSPENSA') { r.susp++; r.cxSusp += cx }
      else { r.lib++; r.cxLib += cx }
    }
    return r
  }, [linhas])

  const est = useMemo(() => {
    const e = { cx: 0, m: 0, bob: 0, toco: 0 }
    if (!estoque) return e
    for (const x of estoque) {
      if (!resumo.skus.has(x.material)) continue
      e.cx += Number(x.caixas_previstas) || 0
      e.m += Number(x.estoque_m) || 0
      e.bob += Number(x.qtde_bobinas) || 0
      e.toco += Number(x.qtde_tocos) || 0
    }
    return e
  }, [estoque, resumo])

  const limpar = () => { setCliente(''); setMaterial('') }

  return (
    <div className="cs-page">
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.3px' }}>Consultar</h1>
          <div style={{ fontSize: 13, color: '#5A6675', marginTop: 2 }}>Acompanhe os pedidos de um cliente ou material: estoque e previsão de produção.</div>
        </div>
      </header>

      <section className="cs-busca">
        <label className="cs-fld">Cliente
          <input type="text" list="cs-clientes" placeholder="Ex.: nome do cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} autoComplete="off" />
          <datalist id="cs-clientes">{clientes.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="cs-fld">Material (SKU)
          <input type="text" placeholder="Ex.: 208004B" value={material} onChange={(e) => setMaterial(e.target.value)} autoComplete="off" />
        </label>
        {(cliente || material) && <button className="btn" onClick={limpar}>Limpar</button>}
        <div className="cs-cont" role="status">
          {pedidos === null && !erro ? 'Carregando…' : buscando ? `${fmtN(linhas.length)} ${linhas.length === 1 ? 'OP encontrada' : 'OPs encontradas'}` : ''}
        </div>
      </section>

      {erro && <div className="msg err" role="alert">{erro} <button className="linkbtn" onClick={carregar}>tentar de novo</button></div>}

      {!buscando && pedidos !== null && !erro && (
        <div className="cs-vazio">Digite o nome de um cliente ou o código de um material (SKU) para ver os pedidos.</div>
      )}
      {buscando && pedidos !== null && !linhas.length && !erro && (
        <div className="cs-vazio">Nenhum pedido encontrado para essa busca.</div>
      )}

      {linhas.length > 0 && (
        <>
          <section className="cs-cards">
            <div className="cs-card"><span>Materiais (SKUs) com OP</span><b>{fmtN(resumo.skus.size)}</b></div>
            <div className="cs-card"><span>OPs cadastradas</span><b>{fmtN(resumo.total)}</b></div>
            <div className="cs-card" style={{ background: '#E1F3E8', border: 0 }}><span style={{ color: '#0F5F34' }}>OPs liberadas</span><b style={{ color: '#0F5F34' }}>{fmtN(resumo.lib)}</b></div>
            <div className="cs-card" style={{ background: '#FFF0D1', border: 0 }}><span style={{ color: '#74460A' }}>OPs suspensas</span><b style={{ color: '#74460A' }}>{fmtN(resumo.susp)}</b></div>
            <div className="cs-card" style={{ background: '#EEF1F5', border: 0 }}><span style={{ color: '#3B4756' }}>OPs já onduladas</span><b style={{ color: '#3B4756' }}>{fmtN(resumo.ond)}</b></div>
          </section>

          <section className="cs-cards cs-cards2">
            <div className="cs-card">
              <span>Quantidade em caixas (todas as OPs)</span>
              <b>{fmtN(resumo.cxLib + resumo.cxSusp + resumo.cxOnd)}</b>
              <small>Liberadas {fmtN(resumo.cxLib)} · Suspensas {fmtN(resumo.cxSusp)} · Já onduladas {fmtN(resumo.cxOnd)}</small>
            </div>
            <div className="cs-card">
              <span>Estoque de bobinas</span>
              <div className="cs-estq">
                <span><b>{fmtN(est.cx)}</b> <em>caixas previstas</em></span>
                <span><b>{fmtN(est.m)}</b> <em>metros</em></span>
              </div>
              <small>{plural(est.bob, 'bobina', 'bobinas')} e {plural(est.toco, 'toco', 'tocos')} em estoque</small>
            </div>
          </section>

          <section className="cs-tabela" role="region" aria-label="Pedidos" tabIndex={0}>
            <div className="cs-row cs-head">
              <div className="cs-cell">Pedido (OP)</div>
              <div className="cs-cell">Material</div>
              <div className="cs-cell cs-num">Caixas</div>
              <div className="cs-cell cs-num">Metros lineares</div>
              <div className="cs-cell">Data de entrega (cliente)</div>
              <div className="cs-cell">Data de entrega (HYG)</div>
              <div className="cs-cell">Estoque atende?</div>
              <div className="cs-cell">Previsão de produção (HYG)</div>
            </div>
            {linhas.map((p) => <Linha key={p.pedido_id ?? p.op} p={p} />)}
          </section>

          <section className="cs-legenda">
            <span><strong>Previsão de produção (HYG)</strong> = data de ruptura real da OP.</span>
            <span>Produção depois da ruptura (atraso): <span className="cs-late">dd/mm/aaaa</span></span>
            <span>OPs já onduladas e suspensas não entram no cálculo de estoque.</span>
          </section>
        </>
      )}
    </div>
  )
}

function Linha({ p }) {
  const ond = p.classificacao === 'JA_ONDULADA'
  const susp = p.classificacao === 'SUSPENSA'
  let badge = 'Não', tom = 'b-warn', prev = '—', prevCls = 'cs-p-mute'
  if (ond) { badge = 'Já ondulada'; tom = 'cs-b-mute' }
  else if (susp) { badge = 'Suspensa'; tom = 'b-warn' }
  else if (p.estoque_atende) { badge = 'Sim'; tom = 'b-ok'; prev = 'Atendida pelo estoque' }
  else if (p.metros_lineares == null || p.previsao_status === 'CADASTRAR_BOBINA') { prev = 'Em análise pelo PCP'; prevCls = 'cs-p-none' }
  else if (p.previsao_status === 'PROGRAMADO' && p.previsao_data) {
    prev = fmtD(p.previsao_data)
    prevCls = p.previsao_atrasada ? 'cs-late' : 'cs-p-date'
  } else { prev = 'Sem programação'; prevCls = 'cs-p-none' }
  return (
    <div className={'cs-row' + (ond || susp ? ' cs-mute' : '')}>
      <div className="cs-cell cs-mono">{p.op}</div>
      <div className="cs-cell cs-mono">{p.material}</div>
      <div className="cs-cell cs-num">{fmtN(p.caixas)}</div>
      <div className="cs-cell cs-num">{fmtN(p.metros_lineares)}</div>
      <div className="cs-cell cs-mono">{fmtD(p.data_entrega)}</div>
      <div className="cs-cell cs-mono">{fmtD(p.data_onduladeira)}</div>
      <div className="cs-cell"><span className={'cs-badge ' + tom}>{badge}</span></div>
      <div className="cs-cell"><span className={prevCls}>{prev}</span></div>
    </div>
  )
}
