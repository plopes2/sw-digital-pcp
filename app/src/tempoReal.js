import { useEffect, useRef } from 'react'
import { supabase } from './supabase.js'

/**
 * Tempo real: chama `aoMudar` sempre que alguma das tabelas ("schema.tabela") mudar no banco,
 * por qualquer usuário. Várias mudanças seguidas (ex.: reordenar a fila) viram UMA só recarga.
 * Também recarrega ao reconectar (queda de internet) e ao voltar para a aba do navegador,
 * para nunca ficar com dado velho. As regras de acesso (RLS) valem: só recebe quem pode ler a tabela.
 */
export function useTempoReal(tabelas, aoMudar, ms = 400) {
  const ref = useRef(aoMudar)
  ref.current = aoMudar
  const chave = tabelas.join(',')

  useEffect(() => {
    let timer = null
    let jaConectou = false
    const disparar = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { try { ref.current?.() } catch { /* a tela trata o próprio erro */ } }, ms)
    }

    const canal = supabase.channel('tr-' + Math.random().toString(36).slice(2))
    for (const t of chave.split(',')) {
      const [schema, table] = t.split('.')
      canal.on('postgres_changes', { event: '*', schema, table }, disparar)
    }
    canal.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (jaConectou) disparar() // reconectou: pode ter perdido avisos
        jaConectou = true
      }
    })

    const visivel = () => { if (document.visibilityState === 'visible') disparar() }
    document.addEventListener('visibilitychange', visivel)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visivel)
      supabase.removeChannel(canal)
    }
  }, [chave, ms])
}

/* Conjuntos de tabelas por assunto (o que cada tela precisa "ouvir") */
export const TR = {
  carga: 'entrada.carga', // novo envio de Pedidos / Estoque / Papel
  fila: ['programacao.fila_linha', 'programacao.dia_calendario', 'programacao.turno_regra', 'programacao.refugo'],
  combos: ['cadastro.material_combinacao', 'cadastro.cliche', 'cadastro.material', 'cadastro.cliente'],
  contratos: ['cadastro.contrato', 'cadastro.contrato_sku'],
  historico: ['acompanhamento.fila_snapshot', 'acompanhamento.realizado'],
}
