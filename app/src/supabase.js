import { createClient } from '@supabase/supabase-js'

// A chave "publishable" é pública por desenho: a segurança está nas regras (RLS) do banco.
const URL = import.meta.env.VITE_SUPABASE_URL || 'https://bpzpljjcooouibknljwm.supabase.co'
const KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_K0v1xInOZpkaeYDFEZU9VA_aeaOBezt'

export const supabase = createClient(URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
})

export const prog = () => supabase.schema('programacao')
export const acesso = () => supabase.schema('acesso')
