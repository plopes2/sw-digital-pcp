import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'
import { useTempoReal, TR } from './tempoReal.js'

const sp = () => supabase.schema('supply')
const cad = () => supabase.schema('cadastro')

const PADRAO = /^C\d{6}B$/
const PLACAS = ['A', 'B', 'C', 'D', 'E']
const MOTIVOS = ['Clichê rasgou', 'Desgaste', 'Danificado', 'Perdido', 'Outro']
const norm = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, '')
const busca = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const fmtD = (s) => (s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) : '')
const fmtDH = (s) => { if (!s) return ''; const d = new Date(s); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}` }
const ROT = { pendente: 'Solicitação pendente', solicitado: 'Clichê solicitado', a_armazenar: 'À armazenar' }
const TOM = { pendente: 'b-warn', solicitado: 'b-info', a_armazenar: 'b-ok' }

function Sim({ c, t, x }) {
  return <span title={t} aria-label={t} style={{ cursor: 'help', whiteSpace: 'nowrap' }}>{c}{x ? <small className="mono" style={{ marginLeft: 3 }}>{x}</small> : null}</span>
}

// Ícone da coluna Clichê da Fila (a mesma lógica será usada lá)
export function simboloCliche({ status, entrega, emMontagem }) {
  const o = []
  if (status === 'pendente') o.push(<Sim key="p" c="✉" t="Solicitação de clichê pendente (ainda não enviada à clicheria)" />)
  else if (status === 'solicitado') o.push(<Sim key="s" c="⏳" t={`Clichê solicitado à clicheria. Entrega prevista: ${fmtD(entrega)}`} x={fmtD(entrega)} />)
  else if (status === 'a_armazenar') o.push(<Sim key="a" c="⇩" t="Clichê pego pela montagem, à armazenar" />)
  if (emMontagem) o.push(<Sim key="m" c="⚙" t="Clichê em montagem (linha liberada acima do bloco de pendências)" />)
  return o.length ? <span style={{ display: 'inline-flex', gap: 8 }}>{o}</span> : <span style={{ color: '#7A8594' }}>—</span>
}

export default function Supply({ perfil }) {
  const ehController = perfil === 'controller'
  const podeOperar = perfil === 'controller' || perfil === 'operacao'
  const [aba, setAba] = useState('Modula')
  const [lista, setLista] = useState(null)
  const [udcs, setUdcs] = useState([])
  const [sols, setSols] = useState([])
  const [liberadas, setLiberadas] = useState(new Set())
  const [hist, setHist] = useState([])
  const [erro, setErro] = useState(null)

  const carregar = useCallback(async () => {
    const [a, b, c, d, e] = await Promise.all([
      sp().from('modula_lista').select('*').order('modula').order('udc').limit(5000),
      sp().from('modula_udc').select('equipamento,udc').order('equipamento').order('udc').limit(5000),
      sp().from('cliche_solicitacao').select('*').neq('status', 'armazenado').order('solicitado_em', { ascending: false }),
      sp().from('cliche_historico').select('*').order('ocorrido_em', { ascending: false }).limit(300),
      sp().from('fila_liberada').select('sku_cliche'),
    ])
    const err = a.error || b.error || c.error || d.error || e.error
    if (err) { setErro(err.message); return }
    setErro(null)
    setLista(a.data); setUdcs(b.data); setSols(c.data); setHist(d.data)
    setLiberadas(new Set((e.data ?? []).map((x) => x.sku_cliche)))
  }, [])
  useEffect(() => { carregar() }, [carregar])
  useTempoReal(['supply.modula_cliche', 'supply.cliche_solicitacao', 'supply.cliche_historico', ...TR.fila], carregar)

  const nUdc = useMemo(() => new Set((lista ?? []).map((r) => r.modula + '-' + r.udc)).size, [lista])
  const nAjustar = useMemo(() => (lista ?? []).filter((r) => r.a_ajustar || r.sku_repetido || r.sem_descricao).length, [lista])

  return (
    <div className="sp-page">
      <header className="sp-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.3px' }}>Supply</h1>
          <div className="tabs" style={{ marginTop: 8, borderBottom: 0 }}>
            <button className="tab" disabled title="Em breve" style={{ opacity: 0.5, cursor: 'not-allowed' }}>Papel</button>
            <button className={'tab' + (aba === 'Modula' ? ' on' : '')} onClick={() => setAba('Modula')}>Modula</button>
          </div>
        </div>
        <div className="sp-stats" aria-label="Resumo">
          <div><b>{lista ? lista.length : '…'}</b>clichês</div>
          <div><b>{lista ? nUdc : '…'}</b>endereços (UDC)</div>
          <div><b>{lista ? nAjustar : '…'}</b>a conferir</div>
        </div>
      </header>

      {erro && <div className="msg err" role="alert">{erro} <button className="linkbtn" onClick={carregar}>tentar de novo</button></div>}

      <div className="sp-grid">
        <ListaModula lista={lista} />
        <Painel perfil={perfil} ehController={ehController} podeOperar={podeOperar} lista={lista ?? []} udcs={udcs} hist={hist} aoMudar={carregar} />
      </div>

      <Solicitacoes sols={sols} lista={lista ?? []} udcs={udcs} liberadas={liberadas} podeOperar={podeOperar} ehController={ehController} aoMudar={carregar} />
    </div>
  )
}

/* ---------- Lista da Modula (tabela oculta; mostra só o pesquisado) ---------- */
function ListaModula({ lista }) {
  const [q, setQ] = useState('')
  const [todos, setTodos] = useState(false)
  const [mod, setMod] = useState('')
  const [soConferir, setSoConferir] = useState(false)
  const mostrar = todos || q.trim().length > 0
  const linhas = useMemo(() => {
    const t = busca(q)
    return (lista ?? []).filter((r) => {
      if (todos && mod && String(r.modula) !== mod) return false
      if (todos && soConferir && !(r.a_ajustar || r.sku_repetido || r.sem_descricao)) return false
      if (t && !busca(`${r.sku_cliche} ${r.descricao ?? ''} ${r.udc}`).includes(t)) return false
      return true
    })
  }, [lista, q, todos, mod, soConferir])

  return (
    <section className="card sp-lista">
      <h2>Clichês na Modula</h2>
      <div className="sp-toolbar">
        <input className="sp-in" type="search" placeholder="Buscar SKU, descrição ou UDC" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        <button className="btn" onClick={() => setTodos((v) => !v)} aria-expanded={todos}>{todos ? '▴ OCULTAR LISTA' : '▾ VER TODOS OS CLICHÊS'}</button>
      </div>
      {todos && (
        <div className="sp-toolbar">
          <select className="sp-in" value={mod} onChange={(e) => setMod(e.target.value)} aria-label="Modula">
            <option value="">Todas as Modulas</option><option value="1">Modula 1</option><option value="2">Modula 2</option>
          </select>
          <button className={'btn' + (soConferir ? ' primary' : '')} aria-pressed={soConferir} onClick={() => setSoConferir((v) => !v)}>Só a conferir</button>
        </div>
      )}
      {lista === null ? <div style={{ color: '#5A6675' }}>Carregando…</div> : !mostrar ? (
        <div className="cs-vazio">Digite um SKU, uma descrição ou uma UDC para ver o clichê.</div>
      ) : (
        <div className="sp-tabela">
          <div className="sp-row sp-h"><div>Modula</div><div>UDC</div><div>SKU do clichê</div><div>Descrição</div><div>Status</div></div>
          {linhas.map((r) => (
            <div className="sp-row" key={r.id}>
              <div className="mono">{r.modula}</div>
              <div className="mono">{r.udc}</div>
              <div className="mono">{r.sku_cliche}</div>
              <div>
                {r.descricao ?? '—'}
                <div className="sp-notes">
                  {r.a_ajustar && <span className="badge b-err">SKU a ajustar</span>}
                  {r.sku_repetido && <span className="badge b-warn">SKU em mais de um endereço</span>}
                  {r.sem_descricao && <span className="badge b-warn">sem descrição</span>}
                </div>
              </div>
              <div className="sp-notes" style={{ marginTop: 0 }}>
                {r.em_montagem && <span className="badge b-ok">Em montagem</span>}
                {r.solicitacao_status && <span className={'badge ' + TOM[r.solicitacao_status]}>{ROT[r.solicitacao_status]}</span>}
                {!r.em_montagem && !r.solicitacao_status && <span style={{ color: '#7A8594' }}>—</span>}
              </div>
            </div>
          ))}
          {!linhas.length && <div className="sp-row"><div style={{ gridColumn: '1 / -1', color: '#5A6675' }}>Nenhum clichê encontrado.</div></div>}
        </div>
      )}
      {mostrar && lista !== null && (
        <div className="sub" style={{ fontSize: 12, color: '#5A6675' }}>
          {todos ? `${linhas.length} de ${lista.length} clichês. Para buscar um clichê específico, digite o SKU, a descrição ou a UDC na barra de pesquisa acima.` : `Mostrando o material pesquisado (${linhas.length} resultado${linhas.length === 1 ? '' : 's'}). Para buscar outro, digite acima o SKU, a descrição ou a UDC.`}
        </div>
      )}
    </section>
  )
}

/* ---------- Painel lateral: Adicionar/Remover · Solicitar reposição · Histórico ---------- */
function Painel({ ehController, podeOperar, lista, udcs, hist, aoMudar }) {
  const [aba, setAba] = useState('req')
  return (
    <aside className="card sp-painel">
      <div className="tabs" role="tablist" style={{ margin: '-4px 0 4px' }}>
        <button className={'tab' + (aba === 'add' ? ' on' : '')} onClick={() => setAba('add')}>Adicionar / Remover</button>
        <button className={'tab' + (aba === 'req' ? ' on' : '')} onClick={() => setAba('req')}>Solicitar reposição</button>
        <button className={'tab' + (aba === 'hist' ? ' on' : '')} onClick={() => setAba('hist')}>Histórico</button>
      </div>
      {aba === 'add' && <>
        <Adicionar podeOperar={podeOperar} lista={lista} udcs={udcs} aoMudar={aoMudar} />
        <Remover ehController={ehController} lista={lista} aoMudar={aoMudar} />
      </>}
      {aba === 'req' && <Solicitar podeOperar={podeOperar} lista={lista} aoMudar={aoMudar} />}
      {aba === 'hist' && <Historico hist={hist} />}
    </aside>
  )
}

function useRotulo(sku) {
  const [rotulo, setRotulo] = useState(null)
  useEffect(() => {
    setRotulo(null)
    if (!PADRAO.test(sku)) return
    let vivo = true
    cad().from('cliche_vigente').select('rotulo').eq('sku_cliche', sku).limit(1)
      .then(({ data }) => { if (vivo) setRotulo(data?.[0]?.rotulo ?? false) })
    return () => { vivo = false }
  }, [sku])
  return rotulo // null = ainda não sei / false = fora do catálogo
}

function Adicionar({ podeOperar, lista, udcs, aoMudar }) {
  const [sku, setSku] = useState('')
  const [eq, setEq] = useState('1')
  const [udc, setUdc] = useState('')
  const [desc, setDesc] = useState('')
  const [tocou, setTocou] = useState(false)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const n = norm(sku)
  const rotulo = useRotulo(n)
  useEffect(() => { if (rotulo && !tocou) setDesc(rotulo) }, [rotulo, tocou])
  const jaEsta = lista.filter((r) => r.sku_cliche === n)
  const udcsEq = udcs.filter((u) => String(u.equipamento) === eq)
  const udcOk = udcsEq.some((u) => String(u.udc) === udc.trim())
  const nNaUdc = lista.filter((r) => String(r.modula) === eq && String(r.udc) === udc.trim()).length
  const skuOk = PADRAO.test(n)

  const salvar = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null)
    const { error } = await sp().rpc('adicionar_cliche', { p_equipamento: Number(eq), p_udc: Number(udc), p_sku: n, p_descricao: desc.trim() || null })
    setBusy(false)
    if (error) { setMsg({ t: 'err', m: error.message }); return }
    setMsg({ t: 'ok', m: `${n} adicionado na Modula ${eq}, UDC ${udc}.` })
    setSku(''); setDesc(''); setTocou(false); setUdc(''); aoMudar()
  }
  if (!podeOperar) return <div className="msg warnmsg">Só Operação e Controller adicionam clichê.</div>
  return (
    <form onSubmit={salvar} className="sp-form">
      <label className="fld">SKU do clichê
        <input className="mono" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="ex.: C205922B" autoComplete="off" />
      </label>
      {n && !skuOk && <div className="sp-hint bad">SKU precisa ser C + 6 números + B (ex.: C205922B).</div>}
      {skuOk && jaEsta.length > 0 && <div className="sp-hint warn">Já está na Modula {jaEsta[0].modula}, UDC {jaEsta[0].udc}. Incluir de novo só se for outra placa.</div>}
      {skuOk && !jaEsta.length && rotulo && <div className="sp-hint ok">Encontrado no catálogo de clichês.</div>}
      {skuOk && !jaEsta.length && rotulo === false && <div className="sp-hint warn">Não está no catálogo (aba Dados). Pode incluir e cadastrar depois.</div>}
      <div className="sp-2col">
        <label className="fld">Modula
          <select className="sp-in" value={eq} onChange={(e) => { setEq(e.target.value); setUdc('') }}><option value="1">Modula 1</option><option value="2">Modula 2</option></select>
        </label>
        <label className="fld">UDC (endereço)
          <input className="mono" list="sp-udcs" inputMode="numeric" value={udc} onChange={(e) => setUdc(e.target.value)} placeholder="Digite ou escolha" autoComplete="off" />
          <datalist id="sp-udcs">{udcsEq.map((u) => <option key={u.udc} value={u.udc} />)}</datalist>
        </label>
      </div>
      {udc.trim() && !udcOk && <div className="sp-hint bad">UDC {udc.trim()} não existe na Modula {eq}. Só dá para usar endereços já definidos.</div>}
      {udcOk && <div className="sp-hint ok">{nNaUdc === 0 ? 'UDC livre.' : `UDC com ${nNaUdc} clichê${nNaUdc > 1 ? 's' : ''}.`}</div>}
      <label className="fld">Descrição
        <input value={desc} onChange={(e) => { setDesc(e.target.value); setTocou(true) }} placeholder="Preenche sozinha se o SKU estiver no catálogo" />
      </label>
      <button className="btn primary" disabled={!skuOk || !udcOk || busy}>{busy ? 'Salvando…' : 'Adicionar na Modula'}</button>
      {msg && <div className={'msg ' + msg.t}>{msg.m}</div>}
    </form>
  )
}

function Remover({ ehController, lista, aoMudar }) {
  const [sku, setSku] = useState('')
  const [id, setId] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const n = norm(sku)
  const achados = lista.filter((r) => r.sku_cliche === n)
  useEffect(() => { setId(achados[0] ? String(achados[0].id) : '') }, [n, lista.length]) // eslint-disable-line
  const remover = async () => {
    const r = achados.find((x) => String(x.id) === id); if (!r) return
    if (!window.confirm(`Remover ${r.sku_cliche} da Modula ${r.modula}, UDC ${r.udc}?`)) return
    setBusy(true); setMsg(null)
    const { error } = await sp().rpc('remover_cliche', { p_id: Number(id), p_motivo: null })
    setBusy(false)
    if (error) { setMsg({ t: 'err', m: error.message }); return }
    setMsg({ t: 'ok', m: `${r.sku_cliche} removido da Modula ${r.modula}, UDC ${r.udc}. Fica no Histórico.` }); setSku(''); aoMudar()
  }
  return (
    <div className="sp-form" style={{ borderTop: '1px solid #DDE1E7', paddingTop: 12, marginTop: 6 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Remover clichê da Modula <span style={{ fontWeight: 400, color: '#5A6675' }}>(só Controller)</span></h3>
      <label className="fld">SKU do clichê que já está na Modula
        <input className="mono" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="ex.: C205922B" autoComplete="off" disabled={!ehController} />
      </label>
      {!ehController && <div className="sp-hint warn">Só o Controller remove clichê da Modula.</div>}
      {ehController && n && !achados.length && <div className="sp-hint bad">Esse SKU não está na Modula.</div>}
      {ehController && achados.length > 0 && (
        <label className="fld">Qual endereço?
          <select className="sp-in mono" value={id} onChange={(e) => setId(e.target.value)}>
            {achados.map((r) => <option key={r.id} value={r.id}>Modula {r.modula} · UDC {r.udc}</option>)}
          </select>
        </label>
      )}
      <button className="btn danger" disabled={!ehController || !achados.length || busy} onClick={remover}>Remover da Modula</button>
      {msg && <div className={'msg ' + msg.t}>{msg.m}</div>}
    </div>
  )
}

function Solicitar({ podeOperar, lista, aoMudar }) {
  const [sku, setSku] = useState('')
  const [placas, setPlacas] = useState([])
  const [cores, setCores] = useState([])
  const [cor, setCor] = useState('')
  const [motivo, setMotivo] = useState(MOTIVOS[0])
  const [det, setDet] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [doCad, setDoCad] = useState(false)
  const n = norm(sku)
  const skuOk = PADRAO.test(n)
  const rotulo = useRotulo(n)
  const naModula = lista.some((r) => r.sku_cliche === n)

  // Se o SKU está no cadastro de clichês, as cores vêm de lá
  useEffect(() => {
    setDoCad(false)
    if (!skuOk) return
    let vivo = true
    sp().rpc('cores_do_cadastro', { p_sku: n }).then(({ data }) => {
      if (vivo && Array.isArray(data) && data.length) { setCores(data); setDoCad(true) }
    })
    return () => { vivo = false }
  }, [n, skuOk])

  const addCor = () => { const v = cor.trim(); if (v && !cores.includes(v)) setCores([...cores, v]); setCor('') }
  const enviar = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null)
    const { error } = await sp().rpc('solicitar_reposicao', { p_sku: n, p_placas: placas, p_cores: cores, p_motivo: motivo, p_detalhe: det.trim() || null })
    setBusy(false)
    if (error) { setMsg({ t: 'err', m: /unique|duplicate/i.test(error.message) ? 'Já existe uma solicitação em andamento para esse SKU.' : error.message }); return }
    setMsg({ t: 'ok', m: 'Solicitação registrada.' })
    setSku(''); setPlacas([]); setCores([]); setDet(''); aoMudar()
  }
  if (!podeOperar) return <div className="msg warnmsg">Só Operação e Controller solicitam reposição.</div>
  return (
    <form onSubmit={enviar} className="sp-form">
      <label className="fld">SKU do clichê
        <input className="mono" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="ex.: C205922B" autoComplete="off" />
      </label>
      {n && !skuOk && <div className="sp-hint bad">SKU precisa ser C + 6 números + B (ex.: C205922B).</div>}
      {skuOk && <div className={'sp-hint ' + (rotulo ? 'ok' : 'warn')}>{rotulo ? rotulo : rotulo === false ? 'Não está no catálogo (aba Dados).' : ''}{skuOk && !naModula && rotulo !== null ? ' · Não está na Modula.' : ''}</div>}
      <fieldset className="sp-fs"><legend>Placas</legend>
        <div className="sp-chks">{PLACAS.map((p) => (
          <label key={p} className="chk sp-chk"><input type="checkbox" checked={placas.includes(p)} onChange={(e) => setPlacas(e.target.checked ? [...placas, p] : placas.filter((x) => x !== p))} />{p}</label>
        ))}</div>
      </fieldset>
      <fieldset className="sp-fs"><legend>Cores</legend>
        <input className="sp-in" value={cor} onChange={(e) => setCor(e.target.value)} onBlur={addCor}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCor() } }}
          placeholder="Digite a cor e tecle Enter (ex.: Amarelo 02 HG, PRETO CROMIA)" autoComplete="off" />
        <div className="sp-chks" style={{ marginTop: 6 }}>{cores.map((c, i) => (
          <span key={c + i} className="sp-tag">{c}<button type="button" aria-label={'Remover ' + c} onClick={() => setCores(cores.filter((_, j) => j !== i))}>×</button></span>
        ))}</div>
        <div className="sp-hint">{doCad ? 'Cores puxadas do cadastro do clichê. Pode remover ou acrescentar.' : 'Se o SKU estiver no cadastro, as cores vêm de lá automaticamente.'}</div>
      </fieldset>
      <label className="fld">Motivo
        <select className="sp-in" value={motivo} onChange={(e) => setMotivo(e.target.value)}>{MOTIVOS.map((m) => <option key={m}>{m}</option>)}</select>
      </label>
      <label className="fld">Detalhe (opcional)
        <input value={det} onChange={(e) => setDet(e.target.value)} placeholder="ex.: rasgo na placa B, cor 2" />
      </label>
      <button className="btn primary" disabled={!skuOk || !placas.length || !cores.length || busy}>{busy ? 'Enviando…' : 'Enviar solicitação'}</button>
      {msg && <div className={'msg ' + msg.t}>{msg.m}</div>}
      <div className="sp-hint">O aviso por e-mail ainda não está ligado: a solicitação aparece na tabela ao lado e na Fila.</div>
    </form>
  )
}

function Historico({ hist }) {
  const [f, setF] = useState('todos')
  const l = hist.filter((h) => f === 'todos' || h.tipo === f)
  return (
    <div>
      <div className="sp-chks" style={{ marginBottom: 8 }}>
        {[['todos', 'Todos'], ['mov', 'Movimentações'], ['sol', 'Solicitações']].map(([k, t]) => (
          <button key={k} className={'btn sm' + (f === k ? ' primary' : '')} aria-pressed={f === k} onClick={() => setF(k)}>{t}</button>
        ))}
      </div>
      {!l.length && <div className="cs-vazio">Nada por aqui ainda.</div>}
      {l.map((h) => (
        <div key={h.id} style={{ borderBottom: '1px solid #EDF0F4', padding: '8px 0', fontSize: 13 }}>
          <div><span className={'badge ' + (h.tipo === 'mov' ? 'b-ok' : 'b-info')} style={{ marginRight: 6 }}>{h.tipo === 'mov' ? 'Movimentação' : 'Solicitação'}</span><span className="mono">{h.sku_cliche}</span></div>
          <div>{h.texto}</div>
          <div style={{ fontSize: 12, color: '#5A6675' }}>{fmtDH(h.ocorrido_em)}{h.usuario_nome ? ' · ' + h.usuario_nome : ''}</div>
        </div>
      ))}
    </div>
  )
}

/* ---------- Solicitações de reposição ---------- */
function Solicitacoes({ sols, lista, udcs, liberadas, podeOperar, ehController, aoMudar }) {
  const [msg, setMsg] = useState(null)
  const rodar = async (fn, args) => {
    setMsg(null)
    const { error } = await sp().rpc(fn, args)
    if (error) { setMsg(error.message); return false }
    aoMudar(); return true
  }
  return (
    <section className="card">
      <h2>Solicitações de reposição</h2>
      {msg && <div className="msg err" role="alert">{msg}</div>}
      <div className="sp-sols">
        <div className="sp-srow sp-h"><div>SKU do clichê</div><div>Placas</div><div>Cores</div><div>Motivo</div><div>Solicitado</div><div>Status</div><div>Clichê na Fila</div><div>Ação</div></div>
        {!sols.length && <div className="sp-srow"><div style={{ gridColumn: '1 / -1', color: '#5A6675' }}>Nenhuma solicitação em andamento.</div></div>}
        {sols.map((s) => (
          <div className="sp-srow" key={s.id}>
            <div><span className="mono">{s.sku_cliche}</span><div className="sp-sub">{s.descricao}</div></div>
            <div>{s.placas.length ? s.placas.join(', ') : '—'}{s.placas_enviadas && s.placas_enviadas.join(',') !== s.placas.join(',') && <div className="sp-sub">enviadas: {s.placas_enviadas.join(', ')}</div>}</div>
            <div>{s.cores.length ? s.cores.join(', ') : '—'}</div>
            <div>{s.motivo}{s.detalhe ? ' · ' + s.detalhe : ''}</div>
            <div className="sp-sub" style={{ marginTop: 0 }}>{s.solicitado_por_nome}{s.origem === 'fila' ? ' (incluiu na Fila)' : ''} · {fmtDH(s.solicitado_em)}</div>
            <div><span className={'badge ' + TOM[s.status]}>{ROT[s.status]}</span></div>
            <div>{simboloCliche({ status: s.status, entrega: s.entrega_solicitada, emMontagem: liberadas.has(s.sku_cliche) })}</div>
            <div><Acao s={s} lista={lista} udcs={udcs} podeOperar={podeOperar} ehController={ehController} rodar={rodar} /></div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Acao({ s, lista, udcs, podeOperar, ehController, rodar }) {
  const [data, setData] = useState('')
  const [pl, setPl] = useState(s.placas)
  const [eq, setEq] = useState('1')
  const [udc, setUdc] = useState('')
  const [aviso, setAviso] = useState('')
  if (s.status === 'pendente') {
    if (!ehController) return <span className="sp-sub">Só o Controller envia à clicheria</span>
    return (
      <div className="sp-act">
        <label className="sp-sub">Entrega<input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
        <div className="sp-chks">{PLACAS.map((p) => (
          <label key={p} className="chk sp-chk"><input type="checkbox" checked={pl.includes(p)} onChange={(e) => setPl(e.target.checked ? [...pl, p] : pl.filter((x) => x !== p))} />{p}</label>
        ))}</div>
        <button className="btn sm" onClick={async () => { if (!data || !pl.length) { setAviso('Informe a data e as placas'); return } setAviso(''); await rodar('enviar_clicheria', { p_id: s.id, p_entrega: data, p_placas: pl }) }}>Enviar à clicheria</button>
        {aviso && <span className="sp-sub" style={{ color: '#9B2318' }}>{aviso}</span>}
      </div>
    )
  }
  if (!podeOperar) return <span className="sp-sub">—</span>
  if (s.status === 'solicitado') return <button className="btn sm" onClick={() => rodar('montagem_pegou', { p_id: s.id })}>Montagem pegou (à armazenar)</button>
  if (s.status === 'a_armazenar') {
    if (lista.some((r) => r.sku_cliche === s.sku_cliche)) {
      return <div className="sp-act"><span className="sp-sub">Já está na Modula (nada sai do lugar)</span><button className="btn sm" onClick={() => rodar('armazenar', { p_id: s.id })}>Concluir</button></div>
    }
    const lst = udcs.filter((u) => String(u.equipamento) === eq)
    const ok = lst.some((u) => String(u.udc) === udc.trim())
    return (
      <div className="sp-act">
        <div style={{ display: 'flex', gap: 4 }}>
          <select className="sp-in" value={eq} onChange={(e) => { setEq(e.target.value); setUdc('') }} aria-label="Modula"><option value="1">Modula 1</option><option value="2">Modula 2</option></select>
          <input className="sp-in mono" list={'sp-u-' + s.id} value={udc} onChange={(e) => setUdc(e.target.value)} placeholder="UDC" style={{ width: 80 }} />
          <datalist id={'sp-u-' + s.id}>{lst.map((u) => <option key={u.udc} value={u.udc} />)}</datalist>
        </div>
        <button className="btn sm" disabled={!ok} onClick={() => rodar('armazenar', { p_id: s.id, p_equipamento: Number(eq), p_udc: Number(udc) })}>Armazenar</button>
      </div>
    )
  }
  return null
}
