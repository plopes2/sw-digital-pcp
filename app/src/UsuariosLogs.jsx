import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { acesso } from './supabase.js'

const PERFIL = { controller: 'Controller', operacao: 'Operação', consultor: 'Consultor' }
const STATUS = { pendente: ['Pendente', 'b-warn'], ativo: ['Ativo', 'b-ok'], bloqueado: ['Bloqueado', 'b-err'] }
const ACAO = { INSERT: ['Inclusão', 'b-ok'], UPDATE: ['Alteração', 'b-info'], DELETE: ['Exclusão', 'b-err'] }
const TABELAS = [
  'acesso.usuario', 'acompanhamento.fila_snapshot', 'acompanhamento.realizado',
  'cadastro.adaptador', 'cadastro.camisa', 'cadastro.cliche', 'cadastro.cliche_cor', 'cadastro.cliente',
  'cadastro.contrato', 'cadastro.contrato_sku', 'cadastro.material', 'cadastro.papel', 'cadastro.papel_tipo', 'cadastro.tinta',
  'entrada.carga', 'programacao.fila_linha',
]
const PAGINA = 200
const fmtDH = (s) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : '—')
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const ocultos = new Set(['atualizado_em'])

export default function UsuariosLogs({ perfil, meuId, aoMudarPendentes }) {
  const [aba, setAba] = useState('usuarios')
  const [usuarios, setUsuarios] = useState(null)
  const [erro, setErro] = useState(null)

  const carregarUsuarios = useCallback(async () => {
    const { data, error } = await acesso().from('usuario').select('*').order('criado_em', { ascending: false })
    if (error) { setErro(error.message); setUsuarios([]); return }
    setUsuarios(data)
  }, [])
  useEffect(() => { if (perfil === 'controller') carregarUsuarios() }, [perfil, carregarUsuarios])

  useEffect(() => {
    if (usuarios && aoMudarPendentes) aoMudarPendentes(usuarios.filter((x) => x.status === 'pendente').length)
  }, [usuarios, aoMudarPendentes])

  if (perfil !== 'controller') {
    return <div className="msg err">Esta aba é exclusiva do perfil Controller.</div>
  }
  const pendentes = (usuarios || []).filter((u) => u.status === 'pendente').length

  return (
    <>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.3px' }}>Usuários e logs</h1>
          <div style={{ fontSize: 13, color: '#5A6675', marginTop: 2 }}>Aprove cadastros, defina perfis e consulte quem alterou o quê.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={'btn' + (aba === 'usuarios' ? ' primary' : '')} onClick={() => setAba('usuarios')}>
            Usuários{pendentes ? ` (${pendentes} pendente${pendentes > 1 ? 's' : ''})` : ''}
          </button>
          <button className={'btn' + (aba === 'logs' ? ' primary' : '')} onClick={() => setAba('logs')}>Logs</button>
        </div>
      </header>
      {erro && <div className="msg err" role="alert">{erro} <button className="linkbtn" onClick={() => setErro(null)}>fechar</button></div>}
      {aba === 'usuarios'
        ? <Usuarios usuarios={usuarios} meuId={meuId} recarregar={carregarUsuarios} setErro={setErro} />
        : <Logs usuarios={usuarios || []} setErro={setErro} />}
    </>
  )
}

function Usuarios({ usuarios, meuId, recarregar, setErro }) {
  const [escolha, setEscolha] = useState({}) // perfil escolhido por usuário (antes de salvar)
  const [salvando, setSalvando] = useState(null)

  async function salvar(u, mudancas, confirmacao) {
    if (confirmacao && !window.confirm(confirmacao)) return
    setSalvando(u.id); setErro(null)
    const { error } = await acesso().from('usuario').update(mudancas).eq('id', u.id)
    setSalvando(null)
    if (error) { setErro(error.message); return }
    setEscolha((e) => { const { [u.id]: _, ...resto } = e; return resto })
    recarregar()
  }
  const aprovar = (u) => {
    const p = escolha[u.id] || u.perfil || u.perfil_solicitado
    return salvar(u, { perfil: p, status: 'ativo', aprovado_por: meuId, aprovado_em: new Date().toISOString() },
      `Aprovar ${u.nome || u.email} como ${PERFIL[p]}?`)
  }
  const trocarPerfil = (u) => salvar(u, { perfil: escolha[u.id] }, `Mudar o perfil de ${u.nome || u.email} para ${PERFIL[escolha[u.id]]}?`)
  const bloquear = (u) => salvar(u, { status: 'bloqueado' }, `Bloquear o acesso de ${u.nome || u.email}?`)
  const reativar = (u) => salvar(u, { status: 'ativo', aprovado_por: meuId, aprovado_em: new Date().toISOString() }, `Reativar o acesso de ${u.nome || u.email}?`)

  if (usuarios === null) return <div className="loading">Carregando…</div>
  const ordem = { pendente: 0, ativo: 1, bloqueado: 2 }
  const lista = [...usuarios].sort((a, b) => ordem[a.status] - ordem[b.status])

  return (
    <section className="scroller" style={{ maxHeight: 'none' }} role="region" aria-label="Usuários">
      <table className="tb">
        <thead>
          <tr><th>Nome</th><th>E-mail</th><th>Perfil pedido</th><th>Perfil</th><th>Status</th><th>Cadastro</th><th>Aprovado em</th><th>Ação</th></tr>
        </thead>
        <tbody>
          {lista.map((u) => {
            const eu = u.id === meuId
            const pendente = u.status === 'pendente'
            const atual = escolha[u.id] ?? u.perfil ?? u.perfil_solicitado
            const mudou = u.perfil && escolha[u.id] && escolha[u.id] !== u.perfil
            const [stTxt, stCls] = STATUS[u.status] || [u.status, 'b-info']
            return (
              <tr key={u.id} style={pendente ? { background: '#FFF8E6' } : undefined}>
                <td>{u.nome || '—'}{eu && <span className="badge b-info" style={{ marginLeft: 6 }}>você</span>}</td>
                <td>{u.email}</td>
                <td>{PERFIL[u.perfil_solicitado] || '—'}</td>
                <td>
                  {eu || u.status === 'bloqueado'
                    ? (PERFIL[u.perfil] || '—')
                    : (
                      <select className="opin" style={{ width: 120 }} value={atual} onChange={(e) => setEscolha((x) => ({ ...x, [u.id]: e.target.value }))}>
                        {Object.entries(PERFIL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    )}
                </td>
                <td><span className={'badge ' + stCls}>{stTxt}</span></td>
                <td>{fmtDH(u.criado_em)}</td>
                <td>{fmtDH(u.aprovado_em)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {eu ? <span style={{ color: '#5A6675' }}>—</span> : (
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      {pendente && <button className="btn sm primary" disabled={salvando === u.id} onClick={() => aprovar(u)}>Aprovar</button>}
                      {u.status === 'ativo' && mudou && <button className="btn sm primary" disabled={salvando === u.id} onClick={() => trocarPerfil(u)}>Salvar perfil</button>}
                      {u.status !== 'bloqueado' && <button className="btn sm" disabled={salvando === u.id} onClick={() => bloquear(u)}>{pendente ? 'Recusar' : 'Bloquear'}</button>}
                      {u.status === 'bloqueado' && <button className="btn sm" disabled={salvando === u.id} onClick={() => reativar(u)}>Reativar</button>}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {!lista.length && <div className="loading">Nenhum usuário cadastrado.</div>}
    </section>
  )
}

function Logs({ usuarios, setErro }) {
  const hoje = new Date()
  const [de, setDe] = useState(iso(new Date(hoje.getTime() - 7 * 86400000)))
  const [ate, setAte] = useState(iso(hoje))
  const [tabela, setTabela] = useState('')
  const [acao, setAcao] = useState('')
  const [quem, setQuem] = useState('')
  const [busca, setBusca] = useState('')
  const [linhas, setLinhas] = useState(null)
  const [fim, setFim] = useState(false)
  const [aberto, setAberto] = useState(null)

  const nomes = useMemo(() => Object.fromEntries(usuarios.map((u) => [u.id, u.nome || u.email])), [usuarios])

  const buscar = useCallback(async (inicio, anteriores) => {
    let q = acesso().from('log_alteracao').select('*')
    if (de) q = q.gte('ocorrido_em', new Date(de + 'T00:00:00').toISOString())
    if (ate) q = q.lt('ocorrido_em', new Date(new Date(ate + 'T00:00:00').getTime() + 86400000).toISOString())
    if (tabela) { const [e, t] = tabela.split('.'); q = q.eq('esquema', e).eq('tabela', t) }
    if (acao) q = q.eq('acao', acao)
    if (quem) q = q.eq('usuario_id', quem)
    if (busca.trim()) q = q.ilike('registro_id', `%${busca.trim()}%`)
    const { data, error } = await q.order('id', { ascending: false }).range(inicio, inicio + PAGINA - 1)
    if (error) { setErro(error.message); setLinhas(anteriores || []); return }
    setLinhas([...(anteriores || []), ...data])
    setFim(data.length < PAGINA)
  }, [de, ate, tabela, acao, quem, busca, setErro])

  useEffect(() => { setLinhas(null); setAberto(null); buscar(0, []) }, [buscar])

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
        <label className="fld">De<input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
        <label className="fld">Até<input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        <label className="fld">Tabela
          <select className="opin" style={{ minHeight: 40, fontSize: 14 }} value={tabela} onChange={(e) => setTabela(e.target.value)}>
            <option value="">Todas</option>
            {TABELAS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="fld">Ação
          <select className="opin" style={{ minHeight: 40, fontSize: 14 }} value={acao} onChange={(e) => setAcao(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(ACAO).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="fld">Usuário
          <select className="opin" style={{ minHeight: 40, fontSize: 14 }} value={quem} onChange={(e) => setQuem(e.target.value)}>
            <option value="">Todos</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome || u.email}</option>)}
          </select>
        </label>
        <label className="fld">Registro (ID)<input placeholder="ex.: OP, material…" style={{ width: 160 }} value={busca} onChange={(e) => setBusca(e.target.value)} /></label>
        {(de || ate) && <button className="btn" onClick={() => { setDe(''); setAte('') }}>Todas as datas</button>}
        <button className="btn" onClick={() => { setLinhas(null); buscar(0, []) }}>Atualizar</button>
      </div>

      {linhas && <div style={{ fontSize: 13, color: '#3B4756' }}>{linhas.length} registro(s){!fim ? ' — há mais antigos' : ''}</div>}

      <section className="scroller" style={{ maxHeight: 'none' }} role="region" aria-label="Logs de alteração">
        <table className="tb">
          <thead><tr><th>Quando</th><th>Usuário</th><th>Tabela</th><th>Ação</th><th>Registro</th><th>Detalhe</th></tr></thead>
          <tbody>
            {(linhas || []).map((l) => {
              const [acTxt, acCls] = ACAO[l.acao] || [l.acao, 'b-info']
              const abre = aberto === l.id
              return (
                <React.Fragment key={l.id}>
                  <tr>
                    <td>{fmtDH(l.ocorrido_em)}</td>
                    <td>{l.usuario_id ? (nomes[l.usuario_id] || 'usuário removido') : 'sistema'}</td>
                    <td>{l.esquema}.{l.tabela}</td>
                    <td><span className={'badge ' + acCls}>{acTxt}</span></td>
                    <td>{l.registro_id ?? '—'}</td>
                    <td><button className="linkbtn" onClick={() => setAberto(abre ? null : l.id)}>{abre ? 'Ocultar' : 'Ver'}</button></td>
                  </tr>
                  {abre && (
                    <tr><td colSpan={6} style={{ whiteSpace: 'normal', maxWidth: 'none', background: '#F9FAFB' }}><Detalhe l={l} /></td></tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
        {linhas === null && <div className="loading">Carregando…</div>}
        {linhas && !linhas.length && <div className="loading">Nenhum registro para este filtro.</div>}
        {linhas && linhas.length > 0 && !fim && (
          <div className="loading"><button className="btn" onClick={() => buscar(linhas.length, linhas)}>Mostrar mais {PAGINA}</button></div>
        )}
      </section>
    </>
  )
}

const val = (v) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

function Detalhe({ l }) {
  const antes = l.dados_antes || {}
  const depois = l.dados_depois || {}
  let campos
  if (l.acao === 'UPDATE') {
    campos = Object.keys({ ...antes, ...depois })
      .filter((k) => !ocultos.has(k) && JSON.stringify(antes[k]) !== JSON.stringify(depois[k]))
      .map((k) => [k, val(antes[k]), val(depois[k])])
  } else {
    const dados = l.acao === 'INSERT' ? depois : antes
    campos = Object.keys(dados).filter((k) => !ocultos.has(k)).map((k) => [k, l.acao === 'DELETE' ? val(dados[k]) : '', l.acao === 'INSERT' ? val(dados[k]) : ''])
  }
  if (!campos.length) return <span style={{ color: '#5A6675' }}>Sem diferenças além da data de atualização.</span>
  return (
    <table className="tb" style={{ background: '#fff' }}>
      <thead><tr><th>Campo</th>{l.acao !== 'INSERT' && <th>Antes</th>}{l.acao !== 'DELETE' && <th>Depois</th>}</tr></thead>
      <tbody>
        {campos.map(([k, a, d]) => (
          <tr key={k}>
            <td className="mono">{k}</td>
            {l.acao !== 'INSERT' && <td style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{a}</td>}
            {l.acao !== 'DELETE' && <td style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{d}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
