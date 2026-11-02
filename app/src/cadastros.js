import { supabase } from './supabase.js'

const cad = () => supabase.schema('cadastro')

export const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

export const fmtData = (s) => {
  if (!s) return '—'
  const [a, m, d] = String(s).slice(0, 10).split('-')
  return `${d}/${m}/${a.slice(2)}`
}

/** Lê uma view/tabela inteira em páginas de 1000 linhas. */
async function lerTudo(consulta) {
  const out = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta().range(de, de + 999)
    if (error) throw new Error(error.message)
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

/** Todas as combinações Material × Bobina × Clichê (visão cadastro.combinacao_v). */
export const carregarCombinacoes = () => lerTudo(() => cad().from('combinacao_v').select('*').order('material').order('ultimo_uso', { ascending: false, nullsFirst: false }))

/** Materiais cadastrados (inclui os que ainda não têm combinação). */
export const carregarMateriais = () => lerTudo(() => cad().from('material').select('material,descricao').order('material'))

/** Catálogo de clichês (última versão de cada SKU) com cliente, camisa e adaptador. */
export async function carregarCliches() {
  const [cl, clientes, camisas, combos] = await Promise.all([
    lerTudo(() => cad().from('cliche_vigente').select('*').order('sku_cliche')),
    lerTudo(() => cad().from('cliente').select('id,nome')),
    lerTudo(() => cad().from('camisa').select('codigo,adaptador')),
    lerTudo(() => cad().from('material_combinacao').select('sku_cliche,material')),
  ])
  const nomeCli = new Map(clientes.map((c) => [c.id, c.nome]))
  const adapt = new Map(camisas.map((c) => [c.codigo, c.adaptador]))
  const usos = new Map()
  combos.forEach((c) => { if (!usos.has(c.sku_cliche)) usos.set(c.sku_cliche, new Set()); usos.get(c.sku_cliche).add(c.material) })
  return cl.map((c) => ({
    ...c,
    cliente: nomeCli.get(c.cliente_id) || null,
    adaptador: adapt.get(c.camisa) || null,
    materiais: usos.get(c.sku_cliche) ? [...usos.get(c.sku_cliche)].sort() : [],
  }))
}

export async function carregarCores(clicheId) {
  const { data, error } = await cad().from('cliche_cor').select('posicao,cor,anilox,qtde_tinta_lt').eq('cliche_id', clicheId).order('posicao')
  if (error) throw new Error(error.message)
  return data
}

/** Texto único de busca de uma combinação. */
export const palheiro = (c) => norm([c.material, c.material_descricao, c.sku_bobina, c.sku_cliche, c.cliente, c.rotulo, c.papel_codigo, c.papel_tipo].filter(Boolean).join(' '))

export function filtrarCombos(combos, busca) {
  const termos = norm(busca).split(' ').filter(Boolean)
  if (!termos.length) return combos
  return combos.filter((c) => { const p = palheiro(c); return termos.every((t) => p.includes(t)) })
}
