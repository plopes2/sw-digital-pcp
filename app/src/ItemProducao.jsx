import React, { useEffect, useMemo, useState } from 'react'
import { supabase, prog } from './supabase.js'
import { carregarCombinacoes, carregarMateriais, filtrarCombos, fmtData, norm } from './cadastros.js'

const vazio = { data: '', m: '', bob: '', op: '', rup: '', obs: '' }
const MAX = 40

/** Incluir item de produção na Fila: escolhe por material, SKU clichê, SKU bobina ou cliente. */
export default function ItemProducao({ filaRows, onCancel, onIncluido }) {
  const [combos, setCombos] = useState(null)
  const [materiais, setMateriais] = useState([])
  const [erroCarga, setErroCarga] = useState(null)
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState(null) // {material, sku_bobina, sku_cliche, descricao, id?}
  const [novo, setNovo] = useState(false)
  const [nv, setNv] = useState({ material: '', descricao: '', bobina: '', cliche: '' })
  const [cliches, setCliches] = useState(null)
  const [f, setF] = useState(vazio)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    let vivo = true
    Promise.all([carregarCombinacoes(), carregarMateriais()])
      .then(([c, m]) => { if (vivo) { setCombos(c); setMateriais(m) } })
      .catch((e) => vivo && setErroCarga(e.message))
    return () => { vivo = false }
  }, [])

  // catálogo de clichês só é lido ao abrir "Nova combinação"
  useEffect(() => {
    if (!novo || cliches) return
    supabase.schema('cadastro').from('cliche_vigente').select('sku_cliche,rotulo').limit(2000)
      .then(({ data }) => setCliches(new Map((data || []).map((c) => [c.sku_cliche, c.rotulo]))))
  }, [novo, cliches])

  const achados = useMemo(() => (combos && busca.trim() ? filtrarCombos(combos, busca) : null), [combos, busca])

  // agrupa por material (mantendo a ordem de uso: mais recente primeiro)
  const grupos = useMemo(() => {
    const lista = achados ?? []
    const g = new Map()
    lista.slice(0, 400).forEach((c) => { if (!g.has(c.material)) g.set(c.material, []); g.get(c.material).push(c) })
    return [...g.entries()].map(([material, cs]) => ({ material, cs }))
  }, [achados])
  const totalAchados = achados ? achados.length : 0
  const gruposVis = achados ? grupos.slice(0, MAX) : grupos
  const nMateriaisAchados = achados ? new Set(achados.map((c) => c.material)).size : 0

  // se a busca bate exatamente com um material, já deixa a combinação mais recente selecionada
  useEffect(() => {
    if (!achados || novo) return
    const q = norm(busca)
    const exatos = achados.filter((c) => norm(c.material) === q)
    if (exatos.length && !(sel && sel.material === exatos[0].material)) {
      const c = exatos.find((x) => x.mais_recente) || exatos[0]
      setSel({ id: c.id, material: c.material, sku_bobina: c.sku_bobina, sku_cliche: c.sku_cliche, descricao: c.material_descricao })
    }
  }, [achados, busca, novo]) // eslint-disable-line react-hooks/exhaustive-deps

  const materialExiste = (m) => materiais.some((x) => x.material === m.trim().toUpperCase())
  const nvMat = nv.material.trim().toUpperCase()
  const nvCliche = nv.cliche.trim().toUpperCase()
  const rotuloCliche = cliches && nvCliche ? cliches.get(nvCliche) : undefined

  function usarNova() {
    setErro(null)
    if (!nvMat) return setErro('Informe o material')
    if (!/^[0-9]{6,}$/.test(nv.bobina.trim())) return setErro('SKU Bobina: somente números (mínimo 6 dígitos)')
    if (!/^[A-Z0-9][A-Z0-9/#*]*$/.test(nvCliche)) return setErro('Informe o SKU Clichê (ex.: C201977B)')
    if (!materialExiste(nvMat) && !nv.descricao.trim()) return setErro(`O material ${nvMat} é novo: informe a descrição para cadastrá-lo`)
    const ex = materiais.find((x) => x.material === nvMat)
    setSel({ material: nvMat, sku_bobina: nv.bobina.trim(), sku_cliche: nvCliche, descricao: ex?.descricao || nv.descricao.trim(), cadastrar: !ex, nova: true })
    setNovo(false)
  }

  async function incluir(e) {
    e.preventDefault()
    if (!sel) return
    const jaNaFila = filaRows.some((r) => r.tipo === 'op' && r.material === sel.material)
    if (jaNaFila && !window.confirm(`O material ${sel.material} já está na Fila. Incluir outra linha dele mesmo assim?`)) return
    setSalvando(true); setErro(null)
    const { error } = await prog().rpc('inserir_item_manual', {
      p_material: sel.material, p_data: f.data || null, p_m_minima: Number(f.m),
      p_bobinas: f.bob === '' ? null : Number(f.bob), p_op: f.op || null,
      p_data_ruptura: f.rup || null, p_observacoes: f.obs || null,
      p_sku_bobina: sel.sku_bobina, p_sku_cliche: sel.sku_cliche,
      p_descricao_material: sel.cadastrar ? sel.descricao : null,
    })
    setSalvando(false)
    if (error) { setErro('Não foi possível incluir: ' + error.message); return }
    const dd = f.data ? ' em ' + fmtData(f.data).slice(0, 5) : ' (sem data, no fim da Fila)'
    onIncluido(`Item ${sel.material} incluído na Fila${dd} · Bobina ${sel.sku_bobina} · Clichê ${sel.sku_cliche}.`)
  }

  return (
    <section className="card item-prod" aria-label="Incluir item de produção">
      <div className="ip-topo">
        <div>
          <h2>Incluir item de produção</h2>
          <div className="sub">Busque por <b>material</b>, <b>SKU clichê</b>, <b>SKU bobina</b> ou cliente e escolha a combinação. Com data, o item entra depois da última linha daquele dia; sem data, vai para o fim da Fila.</div>
        </div>
        <button type="button" className="btn sm" onClick={onCancel}>Fechar</button>
      </div>

      {erroCarga && <div className="msg err">Não foi possível carregar o cadastro: {erroCarga}</div>}

      {!novo && (
        <>
          <div className="ip-busca">
            <label className="fld" style={{ flex: '1 1 320px' }}>Buscar
              <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: 208097B · C201977B · 20004773 · mondelez" autoComplete="off" />
            </label>
            <button type="button" className="btn" onClick={() => { setNovo(true); setNv({ ...nv, material: busca.trim().toUpperCase() }) }}>+ Nova combinação</button>
          </div>

          {combos === null && !erroCarga && <div className="sub">Carregando combinações…</div>}

          {combos && (
            <div className="ip-lista" role="radiogroup" aria-label="Combinações encontradas">
              <div className="sub">
                {achados
                  ? (totalAchados ? `${nMateriaisAchados} material(is) · ${totalAchados} combinação(ões)${nMateriaisAchados > MAX ? ` — mostrando ${MAX} materiais, refine a busca` : ''}` : '')
                  : 'Digite o material, SKU clichê, SKU bobina ou cliente para ver as combinações.'}
              </div>
              {achados && totalAchados === 0 && (
                <div className="msg warnmsg">Nenhuma combinação encontrada para “{busca}”. Se for um material ou combinação nova, use <b>+ Nova combinação</b>.</div>
              )}
              {gruposVis.map((g) => (
                <div key={g.material} className="ip-grupo">
                  <div className="ip-gcab"><b className="mono">{g.material}</b> <span>{g.cs[0].material_descricao || 'sem descrição'}</span>
                    {g.cs[0].n_combinacoes_material > 1 && <span className="badge b-info">{g.cs[0].n_combinacoes_material} combinações</span>}
                  </div>
                  {g.cs.map((c) => {
                    const on = sel && !sel.nova && sel.id === c.id
                    return (
                      <label key={c.id} className={'ip-opt' + (on ? ' on' : '') + (c.ativo ? '' : ' off')}>
                        <input type="radio" name="combo" checked={!!on} onChange={() => setSel({ id: c.id, material: c.material, sku_bobina: c.sku_bobina, sku_cliche: c.sku_cliche, descricao: c.material_descricao })} />
                        <span className="ip-main">
                          <span>Bobina <b className="mono">{c.sku_bobina}</b></span>
                          <span>Clichê <b className="mono">{c.sku_cliche}</b></span>
                          {c.papel_tipo && <span className="ip-papel">{c.papel_tipo}</span>}
                          {c.cliente && <span className="ip-cli">{c.cliente}</span>}
                        </span>
                        <span className="ip-tags">
                          {c.mais_recente && <span className="badge b-ok">MAIS RECENTE</span>}
                          {!c.ativo && <span className="badge b-err">INATIVA</span>}
                          {c.n_materiais_cliche > 1 && <span className="badge b-info" title="Este clichê também é usado em outros materiais">clichê em {c.n_materiais_cliche} materiais</span>}
                          {c.n_materiais_bobina > 1 && <span className="badge b-info" title="Esta bobina também é usada em outros materiais">bobina em {c.n_materiais_bobina} materiais</span>}
                          {!c.cliche_cadastrado && <span className="badge b-warn" title="O clichê ainda não está no catálogo (cores, camisa e adaptador não aparecem)">clichê fora do catálogo</span>}
                          {c.cliche_status === 'obsoleto' && <span className="badge b-warn" title="A última versão deste clichê na aba DADOS está como obsoleta">clichê OBSOLETO</span>}
                          <span className="ip-uso">{c.ultimo_uso ? `último uso ${fmtData(c.ultimo_uso)}` : 'nunca programada'} · {c.usos} uso(s)</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {novo && (
        <div className="ip-novo">
          <div className="sub">Cadastra uma combinação que ainda não existe. Ela fica salva e aparece nas próximas buscas.</div>
          <div className="ip-campos">
            <label className="fld">Material (caixa) *<input value={nv.material} onChange={(e) => setNv({ ...nv, material: e.target.value })} placeholder="Ex.: 208097B" /></label>
            <label className="fld" style={{ flex: '1 1 260px' }}>Descrição {nvMat && !materialExiste(nvMat) ? '*' : ''}
              <input value={nvMat && materialExiste(nvMat) ? (materiais.find((x) => x.material === nvMat)?.descricao || '') : nv.descricao} disabled={!!nvMat && materialExiste(nvMat)} onChange={(e) => setNv({ ...nv, descricao: e.target.value })} placeholder={materialExiste(nvMat) ? '' : 'Material novo: descrição'} />
            </label>
            <label className="fld">SKU Bobina *<input value={nv.bobina} onChange={(e) => setNv({ ...nv, bobina: e.target.value })} placeholder="Ex.: 20004773" inputMode="numeric" /></label>
            <label className="fld">SKU Clichê *<input value={nv.cliche} onChange={(e) => setNv({ ...nv, cliche: e.target.value })} placeholder="Ex.: C201977B" /></label>
          </div>
          {nvCliche && cliches && (rotuloCliche !== undefined
            ? <div className="msg ok">Clichê no catálogo: {rotuloCliche || 'sem rótulo'}</div>
            : <div className="msg warnmsg">Este clichê não está no catálogo. A combinação funciona, mas cores, camisa e adaptador só aparecem depois de atualizar o catálogo em Cadastros.</div>)}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn primary" onClick={usarNova}>Usar esta combinação</button>
            <button type="button" className="btn" onClick={() => { setNovo(false); setErro(null) }}>Voltar à busca</button>
          </div>
        </div>
      )}

      {erro && <div className="msg err" role="alert">{erro}</div>}

      <form onSubmit={incluir} className="ip-form">
        <div className={'ip-sel' + (sel ? ' ok' : '')}>
          {sel
            ? <>Selecionado: <b className="mono">{sel.material}</b> · {sel.descricao || 'sem descrição'} · Bobina <b className="mono">{sel.sku_bobina}</b> · Clichê <b className="mono">{sel.sku_cliche}</b>{sel.cadastrar ? ' · material novo (será cadastrado)' : ''}</>
            : 'Escolha uma combinação acima para continuar.'}
        </div>
        <div className="ip-campos">
          <label className="fld">Data de produção<input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></label>
          <label className="fld">M. Linear mínima *<input required type="number" min="1" style={{ width: 130 }} value={f.m} onChange={(e) => setF({ ...f, m: e.target.value })} /></label>
          <label className="fld">Bobinas<input type="number" min="0" style={{ width: 90 }} value={f.bob} onChange={(e) => setF({ ...f, bob: e.target.value })} /></label>
          <label className="fld">OP (SAP)<input style={{ width: 120 }} value={f.op} onChange={(e) => setF({ ...f, op: e.target.value })} /></label>
          <label className="fld">Data de ruptura<input type="date" value={f.rup} onChange={(e) => setF({ ...f, rup: e.target.value })} /></label>
          <label className="fld" style={{ flex: '1 1 220px' }}>Observações<input value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} /></label>
          <button className="btn primary" disabled={!sel || salvando}>{salvando ? 'Incluindo…' : 'Incluir na Fila'}</button>
        </div>
      </form>
    </section>
  )
}
