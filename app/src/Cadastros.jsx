import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { carregarCombinacoes, carregarCliches, carregarCores, carregarMateriais, filtrarCombos, fmtData, norm } from './cadastros.js'
import { lerDadosCliches, enviarCliches } from './cliches.js'

const MAX_LINHAS = 300

export default function Cadastros({ perfil }) {
  const ehController = perfil === 'controller'
  const [aba, setAba] = useState('combinacoes')
  return (
    <>
      <header>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.3px' }}>Cadastros</h1>
        <div style={{ fontSize: 13, color: '#5A6675', marginTop: 2 }}>
          Consulta de materiais, bobinas e clichês. Um material pode ter várias bobinas e clichês ao longo do tempo, e um clichê pode servir a vários materiais.
        </div>
      </header>
      <div className="tabs" role="tablist" aria-label="Cadastros">
        <button role="tab" aria-selected={aba === 'combinacoes'} className={'tab' + (aba === 'combinacoes' ? ' on' : '')} onClick={() => setAba('combinacoes')}>Materiais · Bobinas · Clichês</button>
        <button role="tab" aria-selected={aba === 'cliches'} className={'tab' + (aba === 'cliches' ? ' on' : '')} onClick={() => setAba('cliches')}>Catálogo de clichês</button>
      </div>
      {aba === 'combinacoes' ? <Combinacoes ehController={ehController} /> : <Cliches ehController={ehController} />}
    </>
  )
}

/* ============================ Combinações ============================ */
function Combinacoes({ ehController }) {
  const [combos, setCombos] = useState(null)
  const [materiais, setMateriais] = useState([])
  const [erro, setErro] = useState(null)
  const [ok, setOk] = useState(null)
  const [busca, setBusca] = useState('')
  const [soVarias, setSoVarias] = useState(false)
  const [soSemCatalogo, setSoSemCatalogo] = useState(false)
  const [novo, setNovo] = useState(false)
  const [nv, setNv] = useState({ material: '', descricao: '', bobina: '', cliche: '', papel: '' })

  const carregar = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([carregarCombinacoes(), carregarMateriais()])
      setCombos(c); setMateriais(m)
    } catch (e) { setErro(e.message) }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const kpi = useMemo(() => {
    if (!combos) return null
    const mats = new Set(combos.map((c) => c.material))
    const porMat = new Map()
    combos.forEach((c) => porMat.set(c.material, (porMat.get(c.material) || 0) + 1))
    return {
      materiais: mats.size,
      combos: combos.length,
      varias: [...porMat.values()].filter((n) => n > 1).length,
      clicheCompart: new Set(combos.filter((c) => c.n_materiais_cliche > 1).map((c) => c.sku_cliche)).size,
      semCatalogo: new Set(combos.filter((c) => !c.cliche_cadastrado).map((c) => c.sku_cliche)).size,
      semCombo: materiais.filter((m) => !mats.has(m.material)).length,
    }
  }, [combos, materiais])

  const vis = useMemo(() => {
    if (!combos) return null
    let l = filtrarCombos(combos, busca)
    if (soVarias) l = l.filter((c) => c.n_combinacoes_material > 1)
    if (soSemCatalogo) l = l.filter((c) => !c.cliche_cadastrado)
    return l
  }, [combos, busca, soVarias, soSemCatalogo])

  async function alternarAtivo(c) {
    setErro(null)
    const { error } = await supabase.schema('cadastro').from('material_combinacao').update({ ativo: !c.ativo }).eq('id', c.id)
    if (error) { setErro(error.message); return }
    await carregar()
  }

  async function salvarNova(e) {
    e.preventDefault()
    setErro(null); setOk(null)
    const mat = nv.material.trim().toUpperCase()
    const bob = nv.bobina.trim()
    const cli = nv.cliche.trim().toUpperCase()
    if (!mat) return setErro('Informe o material')
    if (!/^[0-9]{6,}$/.test(bob)) return setErro('SKU Bobina: somente números (mínimo 6 dígitos)')
    if (!/^[A-Z0-9][A-Z0-9/#*]*$/.test(cli)) return setErro('Informe o SKU Clichê (ex.: C201977B)')
    const sb = supabase.schema('cadastro')
    const existe = materiais.find((m) => m.material === mat)
    if (!existe) {
      if (!nv.descricao.trim()) return setErro(`O material ${mat} é novo: informe a descrição`)
      const r = await sb.from('material').insert({ material: mat, descricao: nv.descricao.trim() })
      if (r.error) return setErro(r.error.message)
    }
    const { error } = await sb.from('material_combinacao').insert({ material: mat, sku_bobina: bob, sku_cliche: cli, papel_codigo: nv.papel.trim() || null, origem: 'manual' })
    if (error) return setErro(error.code === '23505' ? 'Essa combinação já existe.' : error.message)
    setOk(`Combinação ${mat} · ${bob} · ${cli} cadastrada.`)
    setNv({ material: '', descricao: '', bobina: '', cliche: '', papel: '' }); setNovo(false)
    await carregar()
  }

  // linhas agrupadas por material, para a leitura ficar visual
  const linhas = useMemo(() => {
    if (!vis) return []
    const out = []
    let ult = null
    vis.slice(0, MAX_LINHAS).forEach((c) => { out.push({ c, primeira: c.material !== ult }); ult = c.material })
    return out
  }, [vis])

  return (
    <>
      {erro && <div className="msg err" role="alert">{erro} <button className="linkbtn" onClick={() => setErro(null)}>fechar</button></div>}
      {ok && <div className="msg ok" role="status">{ok} <button className="linkbtn" onClick={() => setOk(null)}>fechar</button></div>}

      {kpi && (
        <section className="card">
          <div className="kpis">
            <div><b>{kpi.materiais}</b><span>materiais com combinação</span></div>
            <div><b>{kpi.combos}</b><span>combinações (material × bobina × clichê)</span></div>
            <div><b>{kpi.varias}</b><span>materiais com mais de uma combinação</span></div>
            <div><b>{kpi.clicheCompart}</b><span>clichês usados em mais de um material</span></div>
            <div className={kpi.semCatalogo ? 'warn' : ''}><b>{kpi.semCatalogo}</b><span>clichês fora do catálogo</span></div>
            {kpi.semCombo > 0 && <div className="warn"><b>{kpi.semCombo}</b><span>materiais sem bobina/clichê</span></div>}
          </div>
        </section>
      )}

      <section className="filtro-fila" aria-label="Filtro dos cadastros">
        <label className="fld" style={{ flex: '1 1 320px' }}>Buscar por material, SKU bobina, SKU clichê, cliente ou rótulo
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: 208097B · C201977B · 20004773 · mondelez" />
        </label>
        <label className="chk"><input type="checkbox" checked={soVarias} onChange={(e) => setSoVarias(e.target.checked)} /> Só materiais com mais de uma combinação</label>
        <label className="chk"><input type="checkbox" checked={soSemCatalogo} onChange={(e) => setSoSemCatalogo(e.target.checked)} /> Só clichê fora do catálogo</label>
        {(busca || soVarias || soSemCatalogo) && <button className="btn" onClick={() => { setBusca(''); setSoVarias(false); setSoSemCatalogo(false) }}>Limpar filtro</button>}
        {ehController && <button className="btn primary" onClick={() => setNovo(!novo)}>+ Nova combinação</button>}
      </section>

      {ehController && novo && (
        <form className="card" onSubmit={salvarNova} aria-label="Nova combinação">
          <h2>Nova combinação</h2>
          <div className="sub">Material novo é cadastrado junto (informe a descrição). Se o material já existe, a combinação é só acrescentada.</div>
          <div className="ip-campos">
            <label className="fld">Material (caixa) *<input value={nv.material} onChange={(e) => setNv({ ...nv, material: e.target.value })} placeholder="Ex.: 208097B" /></label>
            <label className="fld" style={{ flex: '1 1 260px' }}>Descrição (material novo)<input value={nv.descricao} onChange={(e) => setNv({ ...nv, descricao: e.target.value })} /></label>
            <label className="fld">SKU Bobina *<input value={nv.bobina} onChange={(e) => setNv({ ...nv, bobina: e.target.value })} inputMode="numeric" placeholder="Ex.: 20004773" /></label>
            <label className="fld">SKU Clichê *<input value={nv.cliche} onChange={(e) => setNv({ ...nv, cliche: e.target.value })} placeholder="Ex.: C201977B" /></label>
            <label className="fld">Código do papel<input value={nv.papel} onChange={(e) => setNv({ ...nv, papel: e.target.value })} placeholder="opcional" /></label>
            <button className="btn primary">Salvar combinação</button>
            <button type="button" className="btn" onClick={() => setNovo(false)}>Cancelar</button>
          </div>
        </form>
      )}

      <section className="card">
        {vis === null ? <div className="loading">Carregando…</div> : (
          <>
            <div className="sub">{vis.length} combinação(ões){vis.length > MAX_LINHAS ? ` — mostrando as ${MAX_LINHAS} primeiras; refine a busca` : ''}. Em cada material, a combinação usada por último vem primeiro.</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tb tb-cad">
                <thead><tr><th>Material</th><th>Descrição</th><th>SKU Bobina</th><th>SKU Clichê</th><th>Cliente</th><th>Papel</th><th>Último uso</th><th style={{ textAlign: 'right' }}>Usos</th><th>Situação</th>{ehController && <th />}</tr></thead>
                <tbody>
                  {linhas.map(({ c, primeira }) => (
                    <tr key={c.id} className={(primeira ? 'novo-grupo ' : '') + (c.ativo ? '' : 'inativa')}>
                      <td className="mono">{primeira ? <b>{c.material}</b> : ''}</td>
                      <td title={c.material_descricao || ''}>{primeira ? (c.material_descricao || '—') : ''}</td>
                      <td className="mono">{c.sku_bobina}</td>
                      <td className="mono">{c.sku_cliche}</td>
                      <td title={c.rotulo || ''}>{c.cliente || '—'}</td>
                      <td title={c.papel_codigo || ''}>{c.papel_tipo || c.papel_codigo || '—'}</td>
                      <td>{c.ultimo_uso ? fmtData(c.ultimo_uso) : '—'}</td>
                      <td style={{ textAlign: 'right' }} className="mono">{c.usos}</td>
                      <td className="tags">
                        {c.mais_recente && c.n_combinacoes_material > 1 && <span className="badge b-ok">mais recente</span>}
                        {!c.ativo && <span className="badge b-err">inativa</span>}
                        {c.n_materiais_cliche > 1 && <span className="badge b-info" title="Clichê usado em mais de um material">clichê em {c.n_materiais_cliche} mat.</span>}
                        {c.n_materiais_bobina > 1 && <span className="badge b-info" title="Bobina usada em mais de um material">bobina em {c.n_materiais_bobina} mat.</span>}
                        {!c.cliche_cadastrado && <span className="badge b-warn" title="Clichê ainda não está no catálogo">fora do catálogo</span>}
                        {c.cliche_status === 'obsoleto' && <span className="badge b-warn" title="A última versão deste clichê na aba DADOS está como obsoleta">clichê obsoleto</span>}
                      </td>
                      {ehController && <td><button className="btn sm" onClick={() => alternarAtivo(c)}>{c.ativo ? 'Desativar' : 'Reativar'}</button></td>}
                    </tr>
                  ))}
                  {vis.length === 0 && <tr><td colSpan={ehController ? 10 : 9} style={{ color: '#5A6675' }}>Nada encontrado.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  )
}

/* ============================ Catálogo de clichês ============================ */
function Cliches({ ehController }) {
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState(null)
  const [busca, setBusca] = useState('')
  const [abertos, setAbertos] = useState({}) // id -> cores | 'carregando'

  const carregar = useCallback(async () => {
    try { setLista(await carregarCliches()) } catch (e) { setErro(e.message) }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const vis = useMemo(() => {
    if (!lista) return null
    const termos = norm(busca).split(' ').filter(Boolean)
    if (!termos.length) return lista
    return lista.filter((c) => {
      const p = norm([c.sku_cliche, c.cliente, c.rotulo, c.camisa, c.adaptador, c.formato, ...c.materiais].filter(Boolean).join(' '))
      return termos.every((t) => p.includes(t))
    })
  }, [lista, busca])

  async function alternar(c) {
    if (abertos[c.id]) { setAbertos((a) => { const n = { ...a }; delete n[c.id]; return n }); return }
    setAbertos((a) => ({ ...a, [c.id]: 'carregando' }))
    try { const cores = await carregarCores(c.id); setAbertos((a) => ({ ...a, [c.id]: cores })) } catch (e) { setErro(e.message) }
  }

  return (
    <>
      {erro && <div className="msg err" role="alert">{erro} <button className="linkbtn" onClick={() => setErro(null)}>fechar</button></div>}
      {ehController && <AtualizarCatalogo aoConcluir={carregar} total={lista?.length} />}

      <section className="filtro-fila" aria-label="Filtro do catálogo">
        <label className="fld" style={{ flex: '1 1 320px' }}>Buscar por SKU clichê, cliente, rótulo, camisa ou material
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: C201977B · mondelez · 1100" />
        </label>
        {busca && <button className="btn" onClick={() => setBusca('')}>Limpar filtro</button>}
      </section>

      <section className="card">
        {vis === null ? <div className="loading">Carregando…</div> : (
          <>
            <div className="sub">{vis.length} clichê(s){vis.length > MAX_LINHAS ? ` — mostrando os ${MAX_LINHAS} primeiros; refine a busca` : ''}. Clique em uma linha para ver as cores e anilox.</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tb tb-cad">
                <thead><tr><th>SKU Clichê</th><th>Cliente</th><th>Rótulo</th><th>Formato</th><th>Camisa</th><th>Adaptador</th><th style={{ textAlign: 'right' }}>Cores</th><th>Situação</th><th>Materiais que usam</th></tr></thead>
                <tbody>
                  {vis.slice(0, MAX_LINHAS).map((c) => (
                    <React.Fragment key={c.id}>
                      <tr className="clicavel" onClick={() => alternar(c)} aria-expanded={!!abertos[c.id]}>
                        <td className="mono"><b>{c.sku_cliche}</b>{c.versao > 1 ? <span className="badge b-info" style={{ marginLeft: 6 }}>v{c.versao}</span> : null}</td>
                        <td>{c.cliente || '—'}</td>
                        <td title={c.rotulo || ''}>{c.rotulo || '—'}</td>
                        <td className="mono">{c.formato || '—'}</td>
                        <td className="mono">{c.camisa || '—'}</td>
                        <td className="mono">{c.adaptador || '—'}</td>
                        <td style={{ textAlign: 'right' }} className="mono">{c.qtde_cores ?? '—'}</td>
                        <td>{c.status === 'obsoleto' ? <span className="badge b-err">obsoleto</span> : c.status === 'ativo' ? <span className="badge b-ok">ativo</span> : '—'}</td>
                        <td title={c.materiais.join(', ')} className="mono">{c.materiais.length ? c.materiais.slice(0, 3).join(', ') + (c.materiais.length > 3 ? ` +${c.materiais.length - 3}` : '') : '—'}</td>
                      </tr>
                      {abertos[c.id] && (
                        <tr className="det"><td colSpan={9}>
                          {abertos[c.id] === 'carregando' ? 'Carregando cores…' : abertos[c.id].length === 0 ? 'Sem cores cadastradas.' : (
                            <div className="cores">{abertos[c.id].map((k) => (
                              <span key={k.posicao} className="cor"><b>{k.posicao}</b> {k.cor}{k.anilox ? ` · anilox ${k.anilox}` : ''}</span>
                            ))}</div>
                          )}
                          {c.observacao && <div className="sub" style={{ marginTop: 4 }}>Obs.: {c.observacao}</div>}
                        </td></tr>
                      )}
                    </React.Fragment>
                  ))}
                  {vis.length === 0 && <tr><td colSpan={9} style={{ color: '#5A6675' }}>Nada encontrado.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  )
}

function AtualizarCatalogo({ aoConcluir, total }) {
  const input = useRef(null)
  const [st, setSt] = useState({ fase: 'vazio' })

  async function escolher(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSt({ fase: 'lendo', nome: file.name })
    try { setSt({ fase: 'pronto', nome: file.name, res: await lerDadosCliches(file) }) } catch (err) { setSt({ fase: 'falha', msg: err.message }) }
  }
  async function enviar() {
    const { nome, res } = st
    setSt({ fase: 'enviando', nome, prog: [0, res.linhas.length] })
    try {
      const tot = await enviarCliches(res.linhas, (a, b) => setSt({ fase: 'enviando', nome, prog: [a, b] }))
      setSt({ fase: 'ok', tot })
      aoConcluir()
    } catch (err) { setSt({ fase: 'falha', msg: err.message }) }
  }

  return (
    <section className="card">
      <h2>Atualizar catálogo de clichês</h2>
      <div className="sub">Envie a planilha de Programação (RG.PP-002, aba DADOS). O catálogo é acumulado: clichês novos entram, os existentes são atualizados e nada é apagado.{total != null ? ` Hoje há ${total} clichês no catálogo.` : ''}</div>
      {(st.fase === 'vazio' || st.fase === 'ok' || st.fase === 'falha') && (
        <div>
          <input ref={input} type="file" accept=".xlsm,.xlsx" hidden onChange={escolher} />
          <button className="btn" onClick={() => input.current.click()}>Escolher planilha de Programação (.xlsm / .xlsx)</button>
        </div>
      )}
      {st.fase === 'lendo' && <div className="loading" style={{ padding: 8 }}>Lendo {st.nome}…</div>}
      {st.fase === 'falha' && <div className="msg err">{st.msg}</div>}
      {st.fase === 'pronto' && (
        <div className="prev">
          <div><strong>{st.nome}</strong> · aba "DADOS"</div>
          <div className="msg ok">{st.res.resumo}</div>
          {st.res.avisos.map((a, i) => <div key={i} className="msg warnmsg">{a}</div>)}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn primary" disabled={!st.res.linhas.length} onClick={enviar}>Confirmar e atualizar o catálogo</button>
            <button className="btn" onClick={() => setSt({ fase: 'vazio' })}>Cancelar</button>
          </div>
        </div>
      )}
      {st.fase === 'enviando' && <div className="loading" style={{ padding: 8 }}>Enviando {st.prog[0]} de {st.prog[1]}…</div>}
      {st.fase === 'ok' && (
        <div className="msg ok">
          Catálogo atualizado: {st.tot.novos} novo(s), {st.tot.atualizados} atualizado(s)
          {st.tot.clientes_novos ? ` · ${st.tot.clientes_novos} cliente(s) novo(s)` : ''}{st.tot.camisas_novas ? ` · ${st.tot.camisas_novas} camisa(s) nova(s)` : ''}{st.tot.adaptadores_novos ? ` · ${st.tot.adaptadores_novos} adaptador(es) novo(s)` : ''}.
        </div>
      )}
    </section>
  )
}
