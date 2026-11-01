import React, { useState } from 'react'
import { supabase } from './supabase.js'
import Fila from './Fila.jsx'
import Dados from './Dados.jsx'
import Historico from './Historico.jsx'
import UsuariosLogs from './UsuariosLogs.jsx'

const ICONS = {
  Painel: 'M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z',
  'Análise PCP': 'M4 16V9M10 16V4M16 16v-5',
  Fila: 'M7 5h10M7 10h10M7 15h10M3.6 5h.1M3.6 10h.1M3.6 15h.1',
  Supply: 'M3 6.5L10 3l7 3.5v7L10 17l-7-3.5zM3 6.5L10 10l7-3.5M10 10v7',
  Dados: 'M4 5c0-1.3 2.7-2.4 6-2.4s6 1.1 6 2.4-2.7 2.4-6 2.4S4 6.3 4 5zM4 5v10c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4V5',
  Histórico: 'M10 3a7 7 0 100 14 7 7 0 000-14zM10 6v4.2l2.8 1.8',
  Consultar: 'M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM13.2 13.2L17 17',
  'Usuários e logs': 'M7.5 4a3 3 0 100 6 3 3 0 000-6zM2 16.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5',
}
const MENU = ['Painel', 'Análise PCP', 'Fila', 'Supply', 'Dados', 'Histórico', 'Consultar', 'Usuários e logs']
const PERFIL = { controller: 'Controller', operacao: 'Operação', consultor: 'Consultor' }

export default function Shell({ session, usuario }) {
  const [pagina, setPagina] = useState('Fila')
  const disponiveis = { Fila: true, Dados: true, Histórico: true, 'Usuários e logs': usuario.perfil === 'controller' }
  const nome = usuario.nome || usuario.nome_completo || session.user.email
  return (
    <div className="app">
      <div className="rail">
        <nav aria-label="Menu principal">
          <div className="brand">
            <span className="logo">SW</span>
            <span className="navlbl">
              <span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>SW Digital</span>
              <span style={{ display: 'block', fontSize: 12, color: '#5A6675' }}>PCP · Pré-Print</span>
            </span>
          </div>
          {MENU.map((m) => (
            <button key={m} className={'navlink' + (m === pagina ? ' on' : '')} disabled={!disponiveis[m]} title={disponiveis[m] ? '' : m === 'Usuários e logs' ? 'Somente Controller' : 'Em breve'} onClick={() => setPagina(m)}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[m]} /></svg>
              <span className="navlbl">{m}</span>
            </button>
          ))}
          <div className="navfoot">
            <span className="avatar">{String(nome)[0]?.toUpperCase()}</span>
            <span className="navlbl">
              <span style={{ display: 'block', fontSize: 13, fontWeight: 500, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{nome}</span>
              <span style={{ display: 'block', fontSize: 12, color: '#5A6675' }}>Perfil: {PERFIL[usuario.perfil] ?? usuario.perfil}</span>
              <button className="linkbtn" onClick={() => supabase.auth.signOut()}>Sair</button>
            </span>
          </div>
        </nav>
      </div>
      <main className="main">
        {pagina === 'Dados' ? <Dados perfil={usuario.perfil} /> : pagina === 'Histórico' ? <Historico /> : pagina === 'Usuários e logs' ? <UsuariosLogs perfil={usuario.perfil} meuId={session.user.id} /> : <Fila perfil={usuario.perfil} />}
      </main>
    </div>
  )
}
