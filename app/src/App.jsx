import React, { useEffect, useState } from 'react'
import { supabase, acesso } from './supabase.js'
import Login from './Login.jsx'
import Shell from './Shell.jsx'

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = carregando
  const [usuario, setUsuario] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setUsuario(undefined); return }
    let vivo = true
    acesso().from('usuario').select('*').eq('id', session.user.id).maybeSingle()
      .then(({ data, error }) => { if (vivo) setUsuario(error ? { erro: error.message } : (data ?? { status: 'pendente' })) })
    return () => { vivo = false }
  }, [session])

  if (session === undefined) return <div className="loading">Carregando…</div>
  if (!session) return <Login />
  if (usuario === undefined) return <div className="loading">Verificando acesso…</div>

  if (usuario.erro) return <Bloqueio titulo="Não foi possível verificar seu acesso" texto={usuario.erro} />
  if (usuario.status === 'pendente')
    return <Bloqueio titulo="Cadastro aguardando aprovação" texto="Seu cadastro foi recebido. Um Controller precisa liberar seu acesso e definir seu perfil. Tente entrar novamente depois." />
  if (usuario.status === 'bloqueado')
    return <Bloqueio titulo="Acesso bloqueado" texto="Seu acesso está bloqueado. Fale com o Controller." />

  return <Shell session={session} usuario={usuario} />
}

function Bloqueio({ titulo, texto }) {
  return (
    <div className="authwrap">
      <div className="authcard">
        <h1>{titulo}</h1>
        <div style={{ fontSize: 14, color: '#3B4756', lineHeight: 1.5 }}>{texto}</div>
        <button className="btn" onClick={() => supabase.auth.signOut()}>Sair</button>
      </div>
    </div>
  )
}
