/* ------------------------------------------------------------------
 * Leitura da planilha "Histórico Programação Preprint" (DOC-POR-SWRI-AGP-006).
 * Só entram as colunas que existem hoje na Fila do app; o resto é descartado
 * (Realizado, Data Retirada Real, Plano Aderência, Data Cobertura, Linha).
 * Regras combinadas em 31/10/2026:
 *  - Data ruptura: data -> data; janela "09/03 - 17/04" -> primeira data (ano pelo mais próximo da
 *    Data Produção); qualquer outro texto -> vazio.
 *  - Cor da fonte da Data ruptura: verde (qualquer tom) = ruptura -3 dias; preto = data alinhada.
 *  - Sem horário na planilha -> horário vazio (nada é inventado).
 *  - Datas com erro óbvio (ano trocado, texto) são corrigidas pela sequência da planilha e listadas.
 * ------------------------------------------------------------------ */

const DIA = 86400000
// Vermelho não foi definido pelo Pedro; até ele decidir, conta como preto (data usada como está).
export const COR_VERMELHA_VALE = 'preto'

const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
const valida = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d }
const ms = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const fmtBR = (s) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}` }
const dias = (a, b) => (ms(a) - ms(b)) / DIA

export function norm(v) {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function valor(c) {
  let v = c.value
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result
    else if (v.richText) v = v.richText.map((t) => t.text).join('')
    else if (v.text !== undefined) v = v.text
    else if ('error' in v) return null
  }
  if (v && typeof v === 'object' && !(v instanceof Date) && 'error' in v) return null
  return v === undefined ? null : v
}
const txt = (v) => {
  if (v === null || v === undefined || v instanceof Date) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s === '' ? null : s
}
const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const inteiro = (v) => { const n = numero(v); return n === null ? null : Math.round(n) }
const dataDe = (d) => iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())

function hora(v) {
  if (v === null) return null
  if (v instanceof Date) {
    const t = ((v.getTime() + 30000) % DIA + DIA) % DIA
    return `${pad(Math.floor(t / 3600000))}:${pad(Math.floor((t % 3600000) / 60000))}`
  }
  const m = typeof v === 'string' ? v.match(/^\s*(\d{1,2}):(\d{2})/) : null
  return m ? `${pad(+m[1])}:${m[2]}` : null
}

/* ---------- cor da fonte ---------- */
function corFonte(cell) {
  const col = cell.font && cell.font.color
  if (!col) return 'preto'
  if (col.theme !== undefined) {
    if (col.theme === 6 || col.theme === 9) return 'verde'
    if (col.theme === 1) return 'preto'
    return 'desconhecida'
  }
  if (col.argb) {
    const a = String(col.argb).toUpperCase().slice(-6)
    if (a === '000000') return 'preto'
    if (a === 'FF0000') return 'vermelho'
    const r = parseInt(a.slice(0, 2), 16), g = parseInt(a.slice(2, 4), 16), b = parseInt(a.slice(4, 6), 16)
    if (g > r && g > b) return 'verde'
    return 'desconhecida'
  }
  if (col.indexed !== undefined) return col.indexed === 8 || col.indexed === 64 ? 'preto' : 'desconhecida'
  return 'preto'
}

/* ---------- Data Produção ---------- */
// devolve a lista de candidatos, em ordem de preferência
function candidatosData(v) {
  if (v instanceof Date) return [dataDe(v)]
  if (typeof v !== 'string') return []
  const s = v.trim()
  let m
  if ((m = s.match(/^(\d{1,2})-(\d{1,2})\/(\d{1,2})\/(\d{4})/))) { // 07-08/10/2025 -> primeiro dia
    const d1 = +m[1], d2 = +m[2], mm = +m[3], yy = +m[4]
    const out = []
    if (valida(yy, mm, d1)) out.push(iso(yy, mm, d1))
    if (d1 > d2) { const pm = mm === 1 ? 12 : mm - 1, py = mm === 1 ? yy - 1 : yy; if (valida(py, pm, d1)) out.push(iso(py, pm, d1)) }
    return out
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) { // dd/mm/aaaa (ou mm/dd/aaaa, por vizinhança)
    const a = +m[1], b = +m[2], yy = +m[3]
    const out = []
    if (valida(yy, b, a)) out.push(iso(yy, b, a))
    if (a !== b && valida(yy, a, b)) out.push(iso(yy, a, b))
    return out
  }
  if ((m = s.match(/^(\d{1,2})[./](\d{1,2})$/))) return [{ semAno: true, d: +m[1], m: +m[2] }]
  return []
}

// Janela aceitável em relação à linha anterior já aceita
const dentro = (c, ant) => { const x = dias(c, ant); return x >= -20 && x <= 45 }

function escolherData(cands, ant) {
  if (!cands.length) return { data: null }
  if (cands[0] && cands[0].semAno) {
    const { d, m } = cands[0]
    const ref = ant ? Number(ant.slice(0, 4)) : new Date().getUTCFullYear()
    const opc = [ref, ref + 1, ref - 1].filter((y) => valida(y, m, d)).map((y) => iso(y, m, d))
    const ok = ant ? opc.find((c) => dentro(c, ant)) : opc[0]
    return { data: ok ?? opc[0] ?? null, ajuste: 'sem ano' }
  }
  if (!ant) return { data: cands[0] }
  const ok = cands.find((c) => dentro(c, ant))
  if (ok) return { data: ok, ajuste: ok !== cands[0] ? 'dia/mês invertidos' : undefined }
  for (const c of cands) {
    const [y, m, d] = c.split('-').map(Number)
    for (const dy of [1, -1]) {
      if (valida(y + dy, m, d)) { const t = iso(y + dy, m, d); if (dentro(t, ant)) return { data: t, ajuste: 'ano' } }
    }
  }
  return { data: cands[0], fora: true }
}

/* ---------- Data ruptura ---------- */
function parseRuptura(v, prod) {
  if (v instanceof Date) return dataDe(v)
  if (typeof v !== 'string') return null
  const m = v.match(/^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/)
  if (!m) return null
  const d = +m[1], mo = +m[2]
  if (m[3]) return valida(+m[3], mo, d) ? iso(+m[3], mo, d) : null
  const py = Number(prod.slice(0, 4))
  const opc = [py - 1, py, py + 1].filter((y) => valida(y, mo, d)).map((y) => iso(y, mo, d))
  if (!opc.length) return null
  return opc.sort((a, b) => Math.abs(dias(a, prod)) - Math.abs(dias(b, prod)))[0]
}

/* ---------- Clichê ---------- */
function parseCliche(v, prod) {
  let chegada = null
  let disponivelTexto = false
  if (v instanceof Date) chegada = dataDe(v)
  else if (typeof v === 'number' && v > 30000 && v < 60000) chegada = dataDe(new Date(Date.UTC(1899, 11, 30) + v * DIA))
  else if (typeof v === 'string') {
    if (/dispon/i.test(v)) disponivelTexto = true
    else {
      const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
      if (m && valida(+m[3], +m[2], +m[1])) chegada = iso(+m[3], +m[2], +m[1])
    }
  }
  const disponivel = disponivelTexto ? true : chegada ? chegada <= prod : true
  return { disponivel, chegada }
}

/* ---------- leitura ---------- */
const CAMPOS = {
  op: ['op'], material: ['material'], sku_bobina: ['sku bobina'], sku_cliche: ['sku cliche'], cliche: ['cliche'],
  rotulo: ['cliente'], data_producao: ['data producao'], tempo_h: ['production time h'], inicio: ['inicio'], fim: ['fim'],
  ruptura: ['data ruptura'], observacoes: ['observacoes'], m_minima: ['metragem minima', 'm minima'],
  bobinas: ['bobinas previstas'], papel: ['cod papel', 'papel'], status_papel: ['status papel'],
  tipo_forn: ['tipo papel fornecedor'], volume: ['volume msm'], camisa: ['camisa mm'], adaptador: ['adaptador mm'],
  qtde_cores: ['qtd cores'], montagem: ['status montagem'], faca: ['faca item novo'], pit_stop: ['pit stop'],
  retirada: ['data retirada real cliche'],
}
for (let i = 1; i <= 9; i++) { CAMPOS['cor' + i] = ['cor ' + i]; CAMPOS['anilox' + i] = ['anilox ' + i] }

export async function lerHistorico(buffer) {
  const mod = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)

  let ws = null, map = null, cab = 0
  for (const sh of wb.worksheets) {
    for (let r = 1; r <= Math.min(sh.rowCount, 30) && !ws; r++) {
      const m = {}
      sh.getRow(r).eachCell({ includeEmpty: false }, (c, col) => {
        const n = norm(valor(c))
        for (const [campo, nomes] of Object.entries(CAMPOS)) if (nomes.includes(n) && m[campo] === undefined) m[campo] = col
      })
      if (m.data_producao && m.sku_cliche && m.material && m.ruptura) { ws = sh; map = m; cab = r }
    }
    if (ws) break
  }
  if (!ws) throw new Error('Não encontrei o cabeçalho do histórico (colunas Material, SKU Clichê, Data Produção, Data Ruptura).')

  // A partir de certa linha (set/2026) a coluna "ANILOX #72" do RG.PP-002 foi colada sem cabeçalho e as
  // colunas de cor 8 e 9 ficaram uma posição à direita: COR 8 -> col. "ANILOX #8", ANILOX 8 -> "COR #9",
  // COR 9 -> "ANILOX #9", ANILOX 9 -> "DATA RETIRADA REAL". A primeira linha com texto (cor) na coluna
  // "ANILOX #9" marca o início; dali em diante todas as linhas estão deslocadas.
  let deslocadoDesde = Infinity
  if (map.anilox9) {
    for (let r = cab + 1; r <= ws.rowCount; r++) {
      const x = valor(ws.getRow(r).getCell(map.anilox9))
      if (typeof x === 'string' && /[A-Za-z]/.test(x) && !x.trim().startsWith('#')) { deslocadoDesde = r; break }
    }
  }
  const colCor = (i, desl) => (desl && i >= 8 ? { 8: map.anilox8, 9: map.anilox9 }[i] : map['cor' + i])
  const colAnilox = (i, desl) => (desl && i >= 8 ? { 8: map.cor9, 9: map.retirada }[i] : map['anilox' + i])

  const linhas = []
  const erros = []
  const correcoes = []
  const avisos = {}
  const aviso = (k) => { avisos[k] = (avisos[k] || 0) + 1 }
  let ant = null
  let ignoradas = 0

  for (let r = cab + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const cel = (campo) => (map[campo] ? row.getCell(map[campo]) : null)
    const v = (campo) => (map[campo] ? valor(row.getCell(map[campo])) : null)

    const vazia = [v('rotulo'), v('material'), v('data_producao')].every((x) => x === null || (typeof x === 'string' && !x.trim()))
    if (vazia) { ignoradas++; continue }

    const cands = candidatosData(v('data_producao'))
    const esc = escolherData(cands, ant)
    if (!esc.data) { erros.push({ linha: r, msg: `Data Produção inválida (${String(v('data_producao'))})` }); continue }
    const original = v('data_producao')
    if (esc.fora) {
      aviso('data_fora_de_sequencia')
      correcoes.push({ linha: r, de: fmtBR(esc.data), para: fmtBR(esc.data), motivo: 'fora da sequência' })
    }
    if (esc.ajuste || typeof original === 'string' || (original instanceof Date && dataDe(original) !== esc.data)) {
      const de = original instanceof Date ? fmtBR(dataDe(original)) : String(original).trim()
      if (de !== fmtBR(esc.data)) correcoes.push({ linha: r, de, para: fmtBR(esc.data), motivo: esc.ajuste || 'texto' })
    }
    const prod = esc.data
    ant = prod

    const material = txt(v('material'))
    const tipo = material ? 'op' : 'manual'
    const rotulo = txt(v('rotulo'))

    // ---- horários (só se existirem na planilha)
    const ini = hora(v('inicio')), fim = hora(v('fim'))
    const base = { pos: r, data_producao: prod, tipo, observacoes: null }

    if (tipo === 'manual') {
      linhas.push({
        ...base, op: null, material: null, descricao: rotulo,
        inicio: ini, fim, inicio_manual: ini, fim_manual: fim,
        tempo_h: numero(v('tempo_h')) !== null ? Math.round(v('tempo_h') * 100) / 100 : null,
      })
      continue
    }

    // ---- OP
    let op = v('op')
    op = typeof op === 'number' ? String(Math.round(op)) : txt(op)
    if (op && /^[-\s]*$/.test(op)) op = null

    // ---- ruptura
    const rupV = v('ruptura')
    const dataRup = parseRuptura(rupV, prod)
    let alinhada = false
    if (dataRup) {
      let cor = corFonte(cel('ruptura'))
      if (cor === 'vermelho') { aviso('ruptura_vermelha'); cor = COR_VERMELHA_VALE }
      if (cor === 'desconhecida') { aviso('cor_ruptura_desconhecida'); cor = 'preto' }
      alinhada = cor === 'preto'
    }
    if (typeof rupV === 'string' && !dataRup && txt(rupV) && !/^[-\s]+$/.test(rupV)) aviso('ruptura_texto_ignorado')

    // ---- papel
    const papelV = v('papel')
    const papel = typeof papelV === 'number' ? String(Math.round(papelV)) : txt(papelV)
    const tf = txt(v('tipo_forn'))
    let papel_tipo = null, papel_fornecedor = null
    if (tf) { const [a, ...b] = tf.split(/\s+-\s+/); papel_tipo = a || null; papel_fornecedor = b.join(' - ') || null }
    const sp = txt(v('status_papel'))
    let status_papel = null
    if (sp && /^em estoque$/i.test(sp)) status_papel = 'EM ESTOQUE'
    else if (sp && /^falta papel$/i.test(sp)) status_papel = 'FALTA PAPEL'
    else if (sp) aviso('status_papel_fora_do_padrao')

    // ---- clichê
    const cl = parseCliche(v('cliche'), prod)

    // ---- cores
    const cores = []
    const desl = r >= deslocadoDesde
    if (desl) aviso('cores_8_9_lidas_da_posicao_deslocada')
    const lerCel = (col) => (col ? valor(row.getCell(col)) : null)
    for (let i = 1; i <= 9; i++) {
      const cor = txt(lerCel(colCor(i, desl)))
      const an = lerCel(colAnilox(i, desl))
      const anilox = typeof an === 'number' ? String(an) : txt(an)
      if (cor || anilox) cores.push({ posicao: i, cor: cor ?? '', anilox: anilox ?? null })
    }

    const camisa = v('camisa'), adapt = v('adaptador')
    const mm = numero(v('m_minima'))
    const vol = numero(v('volume'))
    const faca = txt(v('faca'))
    const skuB = v('sku_bobina')

    linhas.push({
      ...base, op, material,
      sku_bobina: typeof skuB === 'number' ? String(Math.round(skuB)) : txt(skuB),
      sku_cliche: txt(v('sku_cliche')),
      rotulo,
      inicio: ini, fim,
      tempo_h: numero(v('tempo_h')) !== null ? Math.round(v('tempo_h') * 100) / 100 : null,
      data_ruptura: dataRup, ruptura_alinhada: alinhada,
      observacoes: txt(v('observacoes')),
      m_minima: mm, bobinas: inteiro(v('bobinas')),
      papel_codigo: papel, papel_tipo, papel_fornecedor, status_papel,
      volume_m2: vol,
      camisa: typeof camisa === 'number' ? String(Math.round(camisa)) : null,
      adaptador: typeof adapt === 'number' ? String(Math.round(adapt)) : null,
      qtde_cores: inteiro(v('qtde_cores')),
      montagem: inteiro(v('montagem')),
      faca_item_novo: !!(faca && /x/i.test(faca)),
      pit_stop: inteiro(v('pit_stop')) ?? 0,
      cliche_disponivel: cl.disponivel, cliche_chegada: cl.chegada,
      cores,
    })
  }

  const datas = [...new Set(linhas.map((l) => l.data_producao))].sort()
  return {
    aba: ws.name,
    linhas, erros, correcoes, avisos, ignoradas,
    resumo: linhas.length
      ? `${linhas.length} linhas · ${datas.length} dias de produção (${fmtBR(datas[0])} a ${fmtBR(datas[datas.length - 1])}) · ${linhas.filter((l) => l.tipo === 'manual').length} linhas manuais`
      : '',
  }
}

/** Separa as linhas em blocos de dias completos (para não estourar o tempo de uma chamada). */
export function blocos(linhas, max = 250) {
  const porDia = new Map()
  for (const l of linhas) { if (!porDia.has(l.data_producao)) porDia.set(l.data_producao, []); porDia.get(l.data_producao).push(l) }
  const out = []
  let cur = []
  for (const d of [...porDia.keys()].sort()) {
    const g = porDia.get(d)
    if (cur.length && cur.length + g.length > max) { out.push(cur); cur = [] }
    cur = cur.concat(g)
  }
  if (cur.length) out.push(cur)
  return out
}
