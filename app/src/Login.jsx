import React, { useState } from 'react'
import { supabase } from './supabase.js'

export default function Login() {
  const [modo, setModo] = useState('entrar')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function enviar(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    if (modo === 'entrar') {
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
      if (error) setMsg({ t: 'err', m: error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message })
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password: senha })
      if (error) setMsg({ t: 'err', m: error.message })
      else if (data.session) setMsg({ t: 'ok', m: 'Cadastro criado. Aguarde a liberação do Controller.' })
      else setMsg({ t: 'ok', m: 'Cadastro criado. Confirme o e-mail (se solicitado) e aguarde a liberação do Controller.' })
    }
    setBusy(false)
  }

  return (
    <div className="authwrap">
      <form className="authcard" onSubmit={enviar}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="logo">SW</span>
          <div>
            <h1>SW Digital</h1>
            <div style={{ fontSize: 12, color: '#5A6675' }}>PCP · Pré-Print</div>
          </div>
        </div>
        <label className="fld">E-mail
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="fld">Senha
          <input type="password" required minLength={6} autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'} value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        {msg && <div className={'msg ' + msg.t}>{msg.m}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Aguarde…' : modo === 'entrar' ? 'Entrar' : 'Solicitar acesso'}</button>
        <button type="button" className="linkbtn" onClick={() => { setModo(modo === 'entrar' ? 'cadastro' : 'entrar'); setMsg(null) }}>
          {modo === 'entrar' ? 'Primeiro acesso? Solicitar cadastro' : 'Já tenho cadastro'}
        </button>
      </form>
    </div>
  )
}
