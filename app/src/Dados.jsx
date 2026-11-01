import React, { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { TIPOS, ORDEM_TIPOS, lerArquivo } from './importacao.js'
import { lerHistorico, blocos } from './historico.js'

const fmtDH = (s) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const entrada = () => supabase.schema('entrada')
const motor = () => supabase.schema('motor')

export default function Dados({ perfil }) {
  const ehController = perfil === 'controller'
  const [cargas, setCargas] = useState(null)
  const [erro, setErro] = useState(null)
  const [impacto, setImpacto] = useState(null)

  const carregar = useCallback(async () => {
    const { data, error } = await entrada().from('carga').select('*').order('id', { ascending: false }).limit(60)
    if (error) { setErro(error.message); return }
    setCargas(data)
    // impacto nas demandas
    const [mto, mts] = await Promise.all([
      motor().from('mto_resultado').select('*'),
      motor().from('mts_resultado').select('acao'),
    ])
    if (!mto.error && !mts.error) {
      const c = {}
      ;(mts.data || []).forEach((r) => { c[r.acao] = (c[r.acao] || 0) + 1 })
      setImpacto({
        mto: mto.data.length,
        kiwi: mto.data.filter((r) => r.cadastrar_bobina_kiwi).length,
        mts: c,
        contratos: (mts.data || []).length,
      })
    }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function tornarVigente(id) {
    if (!window.confirm('Voltar a usar esta carga como a vigente? A atual deixa de valer.')) return
    const { error } = await entrada().from('carga').update({ vigente: true }).eq('id', id)
    if (error) setErro(error.message)
    await carregar()
  }

  return (
    <>
      <header>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.3px' }}>Dados</h1>
        <div style={{ fontSize: 13, color: '#5A6675', marginTop: 2 }}>
          Envie os Excel atualizados. Cada envio <strong>substitui</strong> o anterior do mesmo tipo (envie sempre o arquivo completo); o anterior fica guardado no histórico.
        </div>
      </header>

      {erro && <div className="msg err" role="alert">{erro} <button className="linkbtn" onClick={() => setErro(null)}>fechar</button></div>}
      {!ehController && <div className="msg err">Somente o Controller pode enviar arquivos. Você pode consultar o histórico abaixo.</div>}

      {impacto && (
        <section className="card">
          <h2>Demandas calculadas com os dados vigentes</h2>
          <div className="kpis">
            <div><b>{impacto.mto}</b><span>materiais MTO a produzir</span></div>
            {impacto.kiwi > 0 && <div className="warn"><b>{impacto.kiwi}</b><span>sem bobina cadastrada no Kiwi</span></div>}
            {['PRODUZIR', 'RESSUPRIR', 'SUPER ESTOQUE', 'OK'].map((a) => (
              <div key={a} className={a === 'PRODUZIR' ? 'warn' : ''}><b>{impacto.mts[a] || 0}</b><span>contratos MTS: {a}</span></div>
            ))}
          </div>
        </section>
      )}

      <div className="grid-cards">
        {ORDEM_TIPOS.map((t) => (
          <CartaoUpload key={t} tipo={t} vigente={(cargas || []).find((c) => c.tipo === t && c.vigente)} habilitado={ehController} onEnviado={carregar} />
        ))}
      </div>

      <CartaoHistorico habilitado={ehController} />

      <section className="card">
        <h2>Histórico de envios</h2>
        {cargas === null ? <div className="loading">Carregando…</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tb">
              <thead><tr><th>Quando</th><th>Tipo</th><th>Arquivo</th><th style={{ textAlign: 'right' }}>Linhas</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {cargas.map((c) => (
                  <tr key={c.id}>
                    <td>{fmtDH(c.enviado_em)}</td>
                    <td>{TIPOS[c.tipo]?.titulo || c.tipo}</td>
                    <td title={c.nome_arquivo}>{c.nome_arquivo || '—'}</td>
                    <td style={{ textAlign: 'right' }} className="mono">{c.total_linhas}</td>
                    <td>{c.vigente ? <span className="badge b-ok">vigente</span> : <span style={{ color: '#5A6675' }}>anterior</span>}</td>
                    <td>{ehController && !c.vigente && <button className="btn sm" onClick={() => tornarVigente(c.id)}>Voltar a usar</button>}</td>
                  </tr>
                ))}
                {cargas.length === 0 && <tr><td colSpan={6} style={{ color: '#5A6675' }}>Nenhum envio ainda.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

function CartaoUpload({ tipo, vigente, habilitado, onEnviado }) {
  const def = TIPOS[tipo]
  const input = useRef(null)
  const [st, setSt] = useState({ fase: 'vazio' }) // vazio | lendo | pronto | enviando | ok | falha

  async function escolher(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSt({ fase: 'lendo', nome: file.name })
    try {
      const res = await lerArquivo(file, tipo)
      setSt({ fase: 'pronto', nome: file.name, res })
    } catch (err) {
      setSt({ fase: 'falha', nome: file.name, msg: err.message })
    }
  }

  async function enviar() {
    const { nome, res } = st
    setSt({ ...st, fase: 'enviando' })
    const { data, error } = await entrada().rpc('importar_carga', {
      p_tipo: tipo, p_nome_arquivo: nome, p_observacao: null, p_linhas: res.linhas,
    })
    if (error) { setSt({ fase: 'falha', nome, msg: error.message }); return }
    setSt({ fase: 'ok', nome, retorno: data })
    onEnviado()
  }

  const pronto = st.fase === 'pronto'
  const bloqueado = pronto && st.res.erros.length > 0

  return (
    <section className="card">
      <h2>{def.titulo}</h2>
      <div className="sub">{def.origem}</div>
      <div className="vig">
        {vigente
          ? <>Vigente: <strong>{vigente.nome_arquivo || 'sem nome'}</strong> · {vigente.total_linhas} linhas · {fmtDH(vigente.enviado_em)}</>
          : <span style={{ color: '#9B2318' }}>Nenhuma carga vigente</span>}
      </div>

      {habilitado && (st.fase === 'vazio' || st.fase === 'ok' || st.fase === 'falha') && (
        <>
          <input ref={input} type="file" accept=".xlsx" hidden onChange={escolher} />
          <button className="btn" onClick={() => input.current.click()}>Escolher arquivo Excel (.xlsx)</button>
        </>
      )}

      {st.fase === 'lendo' && <div className="loading" style={{ padding: 8 }}>Lendo {st.nome}…</div>}

      {st.fase === 'falha' && <div className="msg err">{st.msg}</div>}

      {pronto && (
        <div className="prev">
          <div><strong>{st.nome}</strong> · aba "{st.res.aba}"</div>
          {st.res.linhas.length > 0 && <div className={st.res.erros.length ? 'msg warnmsg' : 'msg ok'}>{st.res.erros.length ? 'Sem contar as com problema: ' : ''}{st.res.linhas.length} linhas válidas — {st.res.resumo}</div>}
          {st.res.linhas.length === 0 && st.res.erros.length === 0 && <div className="msg err">Nenhuma linha válida encontrada.</div>}
          {st.res.avisos.map((a, i) => <div key={i} className="msg warnmsg">{a}</div>)}
          {st.res.erros.length > 0 && (
            <div className="msg err">
              {st.res.erros.length} linha(s) com problema — corrija o arquivo e envie de novo:
              <ul>{st.res.erros.slice(0, 6).map((e, i) => <li key={i}>linha {e.linha}: {e.msg}</li>)}</ul>
              {st.res.erros.length > 6 && <div>… e mais {st.res.erros.length - 6}.</div>}
            </div>
          )}
          <details>
            <summary>Colunas reconhecidas</summary>
            <div className="mono" style={{ fontSize: 11, lineHeight: 1.6 }}>
              {Object.entries(st.res.colunas).map(([k, v]) => <div key={k}>{k} ← “{v}”</div>)}
            </div>
          </details>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn primary" disabled={bloqueado || st.res.linhas.length === 0} onClick={enviar}>Confirmar e substituir a carga vigente</button>
            <button className="btn" onClick={() => setSt({ fase: 'vazio' })}>Cancelar</button>
          </div>
        </div>
      )}

      {st.fase === 'enviando' && <div className="loading" style={{ padding: 8 }}>Enviando…</div>}

      {st.fase === 'ok' && (
        <div className="msg ok">
          Carga enviada: {st.retorno.linhas} linhas. Já está valendo nos cálculos.
          <Avisos av={st.retorno.avisos} />
        </div>
      )}
    </section>
  )
}

function Avisos({ av }) {
  if (!av) return null
  const itens = []
  if (av.materiais_sem_cadastro?.length) itens.push(`${av.materiais_sem_cadastro.length} material(is) ainda sem cadastro: ${av.materiais_sem_cadastro.slice(0, 8).join(', ')}${av.materiais_sem_cadastro.length > 8 ? '…' : ''}`)
  if (av.papeis_sem_cadastro?.length) itens.push(`${av.papeis_sem_cadastro.length} código(s) de papel sem cadastro: ${av.papeis_sem_cadastro.slice(0, 8).join(', ')}`)
  if (!itens.length) return null
  return <ul>{itens.map((i, k) => <li key={k}>{i}</li>)}</ul>
}

const TXT_AVISOS = {
  status_papel_fora_do_padrao: (n) => `${n} linha(s) com Status Papel fora do padrão (ex.: EMPRÉSTIMO, analisar) ficam sem status.`,
  ruptura_texto_ignorado: (n) => `${n} linha(s) com texto no lugar da data de ruptura ficam sem data.`,
  data_fora_de_sequencia: (n) => `${n} linha(s) com Data Produção fora da sequência foram mantidas como estão — vale conferir.`,
  cores_8_9_lidas_da_posicao_deslocada: (n) => `${n} linha(s) a partir de 17/09/2026 tinham as cores 8 e 9 deslocadas na planilha; foram lidas na posição certa.`,
  ruptura_vermelha: (n) => `${n} data(s) de ruptura em fonte vermelha foram tratadas como preto (alinhada).`,
  cor_ruptura_desconhecida: (n) => `${n} data(s) de ruptura com cor de fonte desconhecida foram tratadas como preto (alinhada).`,
}

function CartaoHistorico({ habilitado }) {
  const input = useRef(null)
  const [st, setSt] = useState({ fase: 'vazio' }) // vazio | lendo | pronto | enviando | ok | falha

  async function escolher(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSt({ fase: 'lendo', nome: file.name })
    try {
      const res = await lerHistorico(await file.arrayBuffer())
      setSt({ fase: 'pronto', nome: file.name, res })
    } catch (err) {
      setSt({ fase: 'falha', nome: file.name, msg: err.message })
    }
  }

  async function enviar() {
    const { nome, res } = st
    const lotes = blocos(res.linhas)
    let dias = 0, linhas = 0
    const pulados = new Set()
    for (let i = 0; i < lotes.length; i++) {
      setSt({ fase: 'enviando', nome, res, prog: `${i + 1} de ${lotes.length}` })
      const { data, error } = await supabase.schema('acompanhamento').rpc('importar_historico', { p_nome_arquivo: nome, p_linhas: lotes[i] })
      if (error) { setSt({ fase: 'falha', nome, msg: `Parou no bloco ${i + 1} de ${lotes.length}: ${error.message}. Os blocos anteriores já foram gravados; é seguro enviar o arquivo de novo.` }); return }
      dias += data.dias; linhas += data.linhas
      ;(data.dias_ja_salvos_pelo_app || []).forEach((d) => pulados.add(d))
    }
    setSt({ fase: 'ok', nome, dias, linhas, pulados: [...pulados] })
  }

  const pronto = st.fase === 'pronto'
  const res = st.res
  return (
    <section className="card">
      <h2>Carga do histórico (planilha antiga)</h2>
      <div className="sub">Planilha "Histórico Programação Preprint" (DOC-POR-SWRI-AGP-006). Entram só as colunas que existem na Fila; Realizado, Data Retirada Real e Plano Aderência não são carregados. Pode ser enviada de novo: substitui apenas o que veio desta carga.</div>

      {habilitado && ['vazio', 'ok', 'falha'].includes(st.fase) && (
        <>
          <input ref={input} type="file" accept=".xlsx" hidden onChange={escolher} />
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => input.current.click()}>Escolher planilha do histórico (.xlsx)</button>
        </>
      )}
      {!habilitado && <div className="sub">Somente o Controller pode carregar o histórico.</div>}

      {st.fase === 'lendo' && <div className="loading" style={{ padding: 8 }}>Lendo {st.nome}… (pode levar alguns segundos)</div>}
      {st.fase === 'falha' && <div className="msg err">{st.msg}</div>}

      {pronto && (
        <div className="prev">
          <div><strong>{st.nome}</strong> · aba "{res.aba}"</div>
          {res.linhas.length > 0 && <div className="msg ok">{res.resumo}</div>}
          {Object.entries(res.avisos).map(([k, n]) => TXT_AVISOS[k] && <div key={k} className="msg warnmsg">{TXT_AVISOS[k](n)}</div>)}
          {res.correcoes.length > 0 && (
            <details>
              <summary>{res.correcoes.length} data(s) corrigida(s) ou para conferir</summary>
              <ul className="msg warnmsg">{res.correcoes.map((c, i) => <li key={i}>linha {c.linha}: {c.de === c.para ? c.de + ' (mantida, fora da sequência: conferir)' : c.de + ' → ' + c.para}</li>)}</ul>
            </details>
          )}
          {res.erros.length > 0 && (
            <div className="msg err">
              {res.erros.length} linha(s) com problema — corrija a planilha e envie de novo:
              <ul>{res.erros.slice(0, 8).map((e, i) => <li key={i}>linha {e.linha}: {e.msg}</li>)}</ul>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn primary" disabled={res.erros.length > 0 || res.linhas.length === 0} onClick={enviar}>Carregar no Histórico</button>
            <button className="btn" onClick={() => setSt({ fase: 'vazio' })}>Cancelar</button>
          </div>
        </div>
      )}

      {st.fase === 'enviando' && <div className="loading" style={{ padding: 8 }}>Gravando bloco {st.prog}…</div>}
      {st.fase === 'ok' && (
        <div className="msg ok">
          Histórico carregado: {st.linhas} linhas em {st.dias} dias.
          {st.pulados.length > 0 && <div>Dias já salvos pelo botão da Fila foram mantidos: {st.pulados.join(', ')}.</div>}
        </div>
      )}
    </section>
  )
}
