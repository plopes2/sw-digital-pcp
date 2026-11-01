import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { supabase } from './supabase.js'
import { CabecalhoFila, LinhaOp } from './Fila.jsx'

const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const ac = () => supabase.schema('acompanhamento')
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const fmtBR = (s) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—')
const hhmm = (s) => (s ? String(s).slice(0, 5) : '—')
const PAGINA = 600
const noop = () => {}

export default function Historico() {
  const hoje = new Date()
  const [de, setDe] = useState(iso(new Date(hoje.getTime() - 30 * 86400000)))
  const [ate, setAte] = useState(iso(hoje))
  const [busca, setBusca] = useState('')
  const [linhas, setLinhas] = useState(null)
  const [erro, setErro] = useState(null)
  const [qtd, setQtd] = useState(PAGINA)

  const carregar = useCallback(async () => {
    setLinhas(null); setErro(null)
    const out = []
    for (let ini = 0; ; ini += 1000) {
      let q = ac()
        .from('fila_snapshot_linha')
        .select('id, ordem, tipo, dados, fila_snapshot!inner(data_ref, origem, criado_em)')
      if (de) q = q.gte('fila_snapshot.data_ref', de)
      if (ate) q = q.lte('fila_snapshot.data_ref', ate)
      const { data, error } = await q
        .order('id')
        .range(ini, ini + 999)
      if (error) { setErro(error.message); setLinhas([]); return }
      out.push(...data)
      if (data.length < 1000) break
    }
    // dia mais recente em cima; dentro do dia, a ordem da fila
    out.sort((a, b) => (a.fila_snapshot.data_ref < b.fila_snapshot.data_ref ? 1 : a.fila_snapshot.data_ref > b.fila_snapshot.data_ref ? -1 : a.ordem - b.ordem))
    setLinhas(out)
    setQtd(PAGINA)
  }, [de, ate])
  useEffect(() => { carregar() }, [carregar])

  const filtradas = useMemo(() => {
    if (!linhas) return []
    const q = busca.trim().toLowerCase()
    if (!q) return linhas
    return linhas.filter((l) => {
      const d = l.dados
      return [d.op, d.material, d.material_descricao, d.rotulo, d.cliente, d.sku_cliche, d.sku_bobina, d.descricao, d.observacoes].some((x) => x && String(x).toLowerCase().includes(q))
    })
  }, [linhas, busca])

  const dias = useMemo(() => new Set(filtradas.map((l) => l.fila_snapshot.data_ref)).size, [filtradas])
  const visiveis = filtradas.slice(0, qtd)

  useEffect(() => { setQtd(PAGINA) }, [busca])

  const itens = useMemo(() => {
    const out = []
    let cur = null
    visiveis.forEach((l) => {
      const dia = l.fila_snapshot.data_ref
      if (dia !== cur) {
        cur = dia
        const [y, m, d] = dia.split('-').map(Number)
        const n = filtradas.filter((x) => x.fila_snapshot.data_ref === dia).length
        out.push({ k: 'dia', label: WD[new Date(y, m - 1, d).getDay()] + ' ' + fmtBR(dia), sub: `${n} linha(s) · ${l.fila_snapshot.origem === 'retroativo' ? 'carga retroativa' : 'salvo em ' + new Date(l.fila_snapshot.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` })
      }
      const d = l.dados
      out.push({ k: l.tipo === 'manual' ? 'manual' : 'op', id: l.id, r: { ...d, id: l.id } })
    })
    return out
  }, [visiveis, filtradas])

  const [exportando, setExportando] = useState(false)
  async function exportar() {
    setExportando(true)
    try {
      const mod = await import('exceljs')
      const ExcelJS = mod.default ?? mod
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Histórico')
      const cab = ['Data Produção', 'OP', 'Material', 'Cliente', 'SKU Bobina', 'SKU Clichê', 'Clichê (chegada)', 'Clichê disponível', 'Início', 'Fim', 'Tempo (h)', 'Data Ruptura', 'Ruptura alinhada', 'Observações', 'M. Mínima', 'Volume (m²)', 'Bobinas', 'Papel', 'Status Papel', 'Tipo Papel', 'Fornecedor', 'Camisa (mm)', 'Adaptador (mm)', 'Qtd Cores', 'Montagem', 'Faca/Item Novo', 'Pit Stop']
      for (let i = 1; i <= 9; i++) cab.push('COR #' + i, 'ANILOX #' + i)
      ws.addRow(cab).font = { bold: true }
      for (const l of filtradas) {
        const d = l.dados
        const cores = Array.isArray(d.cores) ? d.cores : []
        const row = [
          d.data_producao, d.tipo === 'manual' ? null : d.op, d.material, d.tipo === 'manual' ? d.descricao : (d.material_descricao ?? d.rotulo ?? d.cliente), d.sku_bobina, d.sku_cliche,
          d.cliche_chegada, d.tipo === 'manual' ? null : (d.cliche_disponivel ? 'sim' : 'não'), hhmm(d.inicio) === '—' ? null : hhmm(d.inicio), hhmm(d.fim) === '—' ? null : hhmm(d.fim), d.tempo_h,
          d.data_ruptura, d.data_ruptura ? (d.ruptura_alinhada ? 'sim' : 'não') : null, d.observacoes, d.m_minima, d.volume_m2, d.bobinas,
          d.papel_codigo, d.status_papel, d.papel_tipo, d.papel_fornecedor, d.camisa, d.adaptador, d.qtde_cores, d.montagem, d.faca_item_novo ? 'X' : null, d.pit_stop || null,
        ]
        for (let i = 1; i <= 9; i++) { const c = cores.find((x) => Number(x.posicao) === i); row.push(c ? c.cor : null, c ? c.anilox : null) }
        ws.addRow(row)
      }
      ws.views = [{ state: 'frozen', ySplit: 1 }]
      ws.columns.forEach((c) => { c.width = 14 })
      const buf = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url; a.download = `historico_${de || 'inicio'}_a_${ate || 'hoje'}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { setErro('Não foi possível exportar: ' + e.message) }
    setExportando(false)
  }

  return (
    <>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.3px' }}>Histórico</h1>
          <div style={{ fontSize: 13, color: '#5A6675', marginTop: 2 }}>
            Planejado de cada dia de produção (foto da fila salva no botão "Salvar no Histórico"). Para comparar com o realizado, consulte o Lançamento de Produção.
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          <label className="fld">De<input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
          <label className="fld">Até<input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
          {(de || ate) && <button className="btn" title="Remove o filtro de datas e mostra todo o histórico" onClick={() => { setDe(''); setAte('') }}>Todas as datas</button>}
          <label className="fld">Buscar<input placeholder="OP, material, cliente, SKU…" style={{ width: 220 }} value={busca} onChange={(e) => setBusca(e.target.value)} /></label>
          <button className="btn" onClick={carregar}>Atualizar</button>
          <button className="btn" disabled={!filtradas.length || exportando} onClick={exportar}>{exportando ? 'Gerando…' : 'Exportar Excel'}</button>
        </div>
      </header>

      {erro && <div className="msg err" role="alert">{erro} <button className="linkbtn" onClick={() => setErro(null)}>fechar</button></div>}
      {linhas && !erro && (
        <div style={{ fontSize: 13, color: '#3B4756' }}>
          {filtradas.length} linha(s) em {dias} dia(s){!de && !ate ? ' · todas as datas' : ''}{filtradas.length > qtd ? ` — mostrando as ${qtd} mais recentes (a exportação leva todas)` : ''}
        </div>
      )}

      <section className="scroller" role="region" aria-label="Histórico de produção" tabIndex={0}>
        <div className="tbl">
          <CabecalhoFila />
          <DndContext>
            <SortableContext items={itens.filter((i) => i.k === 'op').map((i) => i.id)}>
              {itens.map((it, i) => {
                if (it.k === 'dia') return <div className="dayrow" key={'d' + i}><div className="daylab"><strong>{it.label}</strong><span>{it.sub}</span></div></div>
                if (it.k === 'manual') {
                  return (
                    <div className="g evt" key={it.id} role="row">
                      <div className="c s1" />
                      <div className="c s2" style={{ gridColumn: '2 / 5' }}><span>{it.r.descricao}</span></div>
                      <div className="c mono" style={{ gridColumn: 8 }}>{fmtBR(it.r.data_producao).slice(0, 5)}</div>
                      <div className="c mono" style={{ gridColumn: 9 }}>{hhmm(it.r.inicio)}</div>
                      <div className="c mono" style={{ gridColumn: 10 }}>{hhmm(it.r.fim)}</div>
                    </div>
                  )
                }
                return <LinhaOp key={it.id} r={it.r} ehController={false} podeOp={false} salvar={noop} />
              })}
            </SortableContext>
          </DndContext>
          {filtradas.length > qtd && <div className="loading"><button className="btn" onClick={() => setQtd((n) => n + PAGINA)}>Mostrar mais {Math.min(PAGINA, filtradas.length - qtd)}</button></div>}
          {linhas === null && <div className="loading">Carregando…</div>}
          {linhas && !filtradas.length && !erro && <div className="loading">{busca.trim() ? 'Nada encontrado para essa busca.' : 'Nenhum histórico salvo neste período.'}</div>}
        </div>
      </section>
    </>
  )
}
