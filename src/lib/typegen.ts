import { parseJsonLike } from './formats'
import { convertKeyName } from './keynaming'

export type TargetLanguage =
  | 'typescript'
  | 'go'
  | 'java'
  | 'rust'
  | 'python'
  | 'kotlin'
  | 'swift'
  | 'csharp'
  | 'jsonschema'

export const TARGET_LANGUAGES: Array<{ id: TargetLanguage; label: string; ext: string }> = [
  { id: 'typescript', label: 'TypeScript', ext: 'ts' },
  { id: 'go', label: 'Go', ext: 'go' },
  { id: 'java', label: 'Java', ext: 'java' },
  { id: 'rust', label: 'Rust', ext: 'rs' },
  { id: 'python', label: 'Python', ext: 'py' },
  { id: 'kotlin', label: 'Kotlin', ext: 'kt' },
  { id: 'swift', label: 'Swift', ext: 'swift' },
  { id: 'csharp', label: 'C#', ext: 'cs' },
  { id: 'jsonschema', label: 'JSON Schema', ext: 'json' },
]

type IrType =
  | { kind: 'any' }
  | { kind: 'null' }
  | { kind: 'boolean' }
  | { kind: 'integer' }
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'array'; element: IrType }
  | { kind: 'object'; fields: Map<string, IrField> }
  | { kind: 'union'; members: IrType[] }

interface IrField {
  key: string
  type: IrType
  optional: boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function inferIr(value: unknown): IrType {
  if (value === null || value === undefined) return { kind: 'null' }
  if (typeof value === 'boolean') return { kind: 'boolean' }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { kind: 'integer' } : { kind: 'number' }
  }
  if (typeof value === 'string') return { kind: 'string' }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { kind: 'array', element: { kind: 'any' } }
    }
    let elem = inferIr(value[0])
    for (let i = 1; i < value.length; i += 1) {
      elem = mergeIr(elem, inferIr(value[i]))
    }
    return { kind: 'array', element: elem }
  }
  if (isPlainObject(value)) {
    const fields = new Map<string, IrField>()
    for (const [k, v] of Object.entries(value)) {
      const inferred = inferIr(v)
      fields.set(k, {
        key: k,
        type: inferred,
        optional: inferred.kind === 'null',
      })
    }
    return { kind: 'object', fields }
  }
  return { kind: 'any' }
}

function mergeObjectFields(
  a: Map<string, IrField>,
  b: Map<string, IrField>,
): Map<string, IrField> {
  const merged = new Map<string, IrField>()
  const allKeys = new Set([...a.keys(), ...b.keys()])
  for (const key of allKeys) {
    const fa = a.get(key)
    const fb = b.get(key)
    if (fa && fb) {
      merged.set(key, {
        key,
        type: mergeIr(fa.type, fb.type),
        optional: fa.optional || fb.optional,
      })
    } else if (fa) {
      merged.set(key, { key, type: fa.type, optional: true })
    } else if (fb) {
      merged.set(key, { key, type: fb.type, optional: true })
    }
  }
  return merged
}

function flattenUnion(type: IrType): IrType[] {
  return type.kind === 'union' ? type.members : [type]
}

function mergeIr(a: IrType, b: IrType): IrType {
  if (a.kind === 'any' || b.kind === 'any') return { kind: 'any' }
  if (a.kind === b.kind) {
    if (a.kind === 'array' && b.kind === 'array') {
      return { kind: 'array', element: mergeIr(a.element, b.element) }
    }
    if (a.kind === 'object' && b.kind === 'object') {
      return { kind: 'object', fields: mergeObjectFields(a.fields, b.fields) }
    }
    if (a.kind !== 'union') return a
  }
  if ((a.kind === 'integer' && b.kind === 'number') || (a.kind === 'number' && b.kind === 'integer')) {
    return { kind: 'number' }
  }

  const combined = [...flattenUnion(a), ...flattenUnion(b)]
  const deduped: IrType[] = []

  for (const item of combined) {
    if (item.kind === 'any') return { kind: 'any' }
    if (item.kind === 'object') {
      const idx = deduped.findIndex((x) => x.kind === 'object')
      if (idx !== -1) {
        const existing = deduped[idx] as { kind: 'object'; fields: Map<string, IrField> }
        deduped[idx] = { kind: 'object', fields: mergeObjectFields(existing.fields, item.fields) }
        continue
      }
    }
    if (item.kind === 'array') {
      const idx = deduped.findIndex((x) => x.kind === 'array')
      if (idx !== -1) {
        const existing = deduped[idx] as { kind: 'array'; element: IrType }
        deduped[idx] = { kind: 'array', element: mergeIr(existing.element, item.element) }
        continue
      }
    }
    if (item.kind === 'number') {
      const intIdx = deduped.findIndex((x) => x.kind === 'integer')
      if (intIdx !== -1) {
        deduped[intIdx] = { kind: 'number' }
        continue
      }
    }
    if (item.kind === 'integer' && deduped.some((x) => x.kind === 'number')) {
      continue
    }
    if (!deduped.some((x) => x.kind === item.kind)) {
      deduped.push(item)
    }
  }

  if (deduped.length === 1) return deduped[0]
  return { kind: 'union', members: deduped }
}

function unwrapNullable(type: IrType): { inner: IrType; nullable: boolean } {
  if (type.kind === 'null') {
    return { inner: { kind: 'any' }, nullable: true }
  }
  if (type.kind === 'union') {
    const hasNull = type.members.some((m) => m.kind === 'null')
    if (!hasNull) return { inner: type, nullable: false }
    const nonNull = type.members.filter((m) => m.kind !== 'null')
    if (nonNull.length === 0) return { inner: { kind: 'any' }, nullable: true }
    if (nonNull.length === 1) return { inner: nonNull[0], nullable: true }
    return { inner: { kind: 'union', members: nonNull }, nullable: true }
  }
  return { inner: type, nullable: false }
}

function sanitizeTypeName(raw: string, fallback = 'Root'): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_\-\s.]/g, ' ').trim()
  const pascal = convertKeyName(cleaned || fallback, 'pascal').replace(/[^A-Za-z0-9_]/g, '')
  if (!pascal) return fallback
  if (/^\d/.test(pascal)) return `T${pascal}`
  return pascal
}

function singularize(name: string): string {
  if (name.endsWith('ies') && name.length > 4) return `${name.slice(0, -3)}y`
  if (name.endsWith('ses') && name.length > 4) return name.slice(0, -2)
  if (name.endsWith('s') && !name.endsWith('ss') && name.length > 2) return name.slice(0, -1)
  return name
}

function createNameAllocator() {
  const used = new Set<string>()
  return (preferred: string): string => {
    const base = sanitizeTypeName(preferred, 'Item')
    if (!used.has(base)) {
      used.add(base)
      return base
    }
    let idx = 2
    while (used.has(`${base}${idx}`)) {
      idx += 1
    }
    const candidate = `${base}${idx}`
    used.add(candidate)
    return candidate
  }
}

const RESERVED_KEYWORDS: Record<Exclude<TargetLanguage, 'jsonschema'>, Set<string>> = {
  typescript: new Set(['class', 'default', 'function', 'import', 'return', 'type', 'var']),
  go: new Set(['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var']),
  java: new Set(['abstract', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while']),
  rust: new Set(['as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while']),
  python: new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']),
  kotlin: new Set(['as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in', 'interface', 'is', 'null', 'object', 'package', 'return', 'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while']),
  swift: new Set(['associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate', 'func', 'import', 'init', 'inout', 'internal', 'let', 'open', 'operator', 'private', 'protocol', 'public', 'rethrows', 'static', 'struct', 'subscript', 'typealias', 'var', 'break', 'case', 'continue', 'default', 'defer', 'do', 'else', 'fallthrough', 'for', 'guard', 'if', 'in', 'repeat', 'return', 'switch', 'where', 'while', 'self', 'Self', 'Type']),
  csharp: new Set(['abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char', 'checked', 'class', 'const', 'continue', 'decimal', 'default', 'delegate', 'do', 'double', 'else', 'enum', 'event', 'explicit', 'extern', 'false', 'finally', 'fixed', 'float', 'for', 'foreach', 'goto', 'if', 'implicit', 'in', 'int', 'interface', 'internal', 'is', 'lock', 'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override', 'params', 'private', 'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed', 'short', 'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using', 'virtual', 'void', 'volatile', 'while']),
}

function safeFieldName(
  rawKey: string,
  style: 'camel' | 'pascal' | 'snake',
  lang: Exclude<TargetLanguage, 'jsonschema'>,
  usedNames?: Set<string>,
): string {
  const cleaned = rawKey.replace(/[^A-Za-z0-9_\-\s.]/g, ' ').trim()
  let candidate = convertKeyName(cleaned || 'field', style).replace(/[^A-Za-z0-9_]/g, '')
  if (!candidate) candidate = style === 'pascal' ? 'Field' : 'field'
  if (/^\d/.test(candidate)) {
    candidate = style === 'pascal' ? `Field${candidate}` : `field_${candidate}`
  }

  const wrapKeyword = (name: string): string => {
    if (!RESERVED_KEYWORDS[lang].has(name)) return name
    if (lang === 'rust') return `r#${name}`
    if (lang === 'kotlin' || lang === 'swift') return `\`${name}\``
    if (lang === 'csharp') return `@${name}`
    return `${name}_`
  }

  if (!usedNames) {
    return wrapKeyword(candidate)
  }

  let base = candidate
  let finalName = wrapKeyword(base)
  let suffix = 2
  while (usedNames.has(finalName)) {
    base = `${candidate}${suffix}`
    finalName = wrapKeyword(base)
    suffix += 1
  }
  usedNames.add(finalName)
  return finalName
}

function escapeGoTagKey(key: string): string {
  return key.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, "'")
}

interface CollectedStruct {
  name: string
  fields: IrField[]
}

function collectStructs(
  rootIr: IrType,
  rootName: string,
): { structs: CollectedStruct[]; objectNames: WeakMap<IrType, string> } {
  const alloc = createNameAllocator()
  const objectNames = new WeakMap<IrType, string>()
  const structs: CollectedStruct[] = []

  const visit = (type: IrType, hint: string): void => {
    if (type.kind === 'object') {
      if (objectNames.has(type)) return
      const name = alloc(hint)
      objectNames.set(type, name)
      const fields = Array.from(type.fields.values())
      structs.push({ name, fields })
      for (const field of fields) {
        visit(field.type, field.key)
      }
      return
    }
    if (type.kind === 'array') {
      visit(type.element, singularize(hint) || 'Item')
      return
    }
    if (type.kind === 'union') {
      for (const member of type.members) {
        visit(member, hint)
      }
    }
  }

  visit(rootIr, rootName)
  return { structs, objectNames }
}

function formatTsKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)
}

function renderTypeScript(rootIr: IrType, rootName: string): string {
  const { structs, objectNames } = collectStructs(rootIr, rootName)

  const renderType = (t: IrType): string => {
    switch (t.kind) {
      case 'any':
        return 'unknown'
      case 'null':
        return 'null'
      case 'boolean':
        return 'boolean'
      case 'integer':
      case 'number':
        return 'number'
      case 'string':
        return 'string'
      case 'array': {
        const inner = renderType(t.element)
        return inner.includes('|') ? `Array<${inner}>` : `${inner}[]`
      }
      case 'object':
        return objectNames.get(t) ?? 'Record<string, unknown>'
      case 'union':
        return t.members.map(renderType).join(' | ')
    }
  }

  const blocks: string[] = []
  if (rootIr.kind !== 'object') {
    const safeRoot = sanitizeTypeName(rootName)
    blocks.push(`export type ${safeRoot} = ${renderType(rootIr)};`)
  }
  for (const st of structs) {
    const lines = [`export interface ${st.name} {`]
    for (const f of st.fields) {
      const opt = f.optional ? '?' : ''
      lines.push(`  ${formatTsKey(f.key)}${opt}: ${renderType(f.type)};`)
    }
    lines.push('}')
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

function renderGo(rootIr: IrType, rootName: string): string {
  const { structs, objectNames } = collectStructs(rootIr, rootName)

  const renderType = (t: IrType, pointerIfOptional: boolean): string => {
    const { inner, nullable } = unwrapNullable(t)
    const ptr = pointerIfOptional || nullable ? '*' : ''
    switch (inner.kind) {
      case 'any':
        return 'any'
      case 'null':
        return 'any'
      case 'boolean':
        return `${ptr}bool`
      case 'integer':
        return `${ptr}int64`
      case 'number':
        return `${ptr}float64`
      case 'string':
        return `${ptr}string`
      case 'array':
        return `[]${renderType(inner.element, false)}`
      case 'object':
        return `${ptr}${objectNames.get(inner) ?? 'map[string]any'}`
      case 'union':
        return 'any'
    }
  }

  const blocks: string[] = []
  if (rootIr.kind !== 'object') {
    blocks.push(`type ${sanitizeTypeName(rootName)} = ${renderType(rootIr, false)}`)
  }
  for (const st of structs) {
    const usedFields = new Set<string>()
    const lines = [`type ${st.name} struct {`]
    for (const f of st.fields) {
      const goField = safeFieldName(f.key, 'pascal', 'go', usedFields)
      const goType = renderType(f.type, f.optional)
      const escapedKey = escapeGoTagKey(f.key)
      const tag = f.optional ? `${escapedKey},omitempty` : escapedKey
      lines.push(`\t${goField} ${goType} \`json:"${tag}"\``)
    }
    lines.push('}')
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

function renderJava(rootIr: IrType, rootName: string): string {
  const { structs, objectNames } = collectStructs(rootIr, rootName)

  const renderType = (t: IrType, boxed: boolean): string => {
    const { inner, nullable } = unwrapNullable(t)
    const useBoxed = boxed || nullable
    switch (inner.kind) {
      case 'any':
      case 'null':
      case 'union':
        return 'Object'
      case 'boolean':
        return useBoxed ? 'Boolean' : 'boolean'
      case 'integer':
        return useBoxed ? 'Long' : 'long'
      case 'number':
        return useBoxed ? 'Double' : 'double'
      case 'string':
        return 'String'
      case 'array':
        return `List<${renderType(inner.element, true)}>`
      case 'object':
        return objectNames.get(inner) ?? 'Map<String, Object>'
    }
  }

  const header = 'import com.fasterxml.jackson.annotation.JsonProperty;\nimport java.util.List;\n'
  const blocks: string[] = []
  if (rootIr.kind !== 'object' && structs.length === 0) {
    const cls = sanitizeTypeName(rootName)
    blocks.push(`public class ${cls} {\n    private ${renderType(rootIr, true)} value;\n}`)
  }
  for (const st of structs) {
    const usedFields = new Set<string>()
    const lines = [`public class ${st.name} {`]
    for (const f of st.fields) {
      const fieldName = safeFieldName(f.key, 'camel', 'java', usedFields)
      const fieldType = renderType(f.type, f.optional)
      if (fieldName !== f.key) {
        lines.push(`    @JsonProperty(${JSON.stringify(f.key)})`)
      }
      lines.push(`    private ${fieldType} ${fieldName};`)
    }
    lines.push('}')
    blocks.push(lines.join('\n'))
  }
  return `${header}\n${blocks.join('\n\n')}`
}

function renderRust(rootIr: IrType, rootName: string): string {
  const { structs, objectNames } = collectStructs(rootIr, rootName)

  const renderType = (t: IrType, optional: boolean): string => {
    const { inner, nullable } = unwrapNullable(t)
    const wrap = (base: string) => (optional || nullable ? `Option<${base}>` : base)
    switch (inner.kind) {
      case 'any':
      case 'null':
      case 'union':
        return wrap('serde_json::Value')
      case 'boolean':
        return wrap('bool')
      case 'integer':
        return wrap('i64')
      case 'number':
        return wrap('f64')
      case 'string':
        return wrap('String')
      case 'array':
        return wrap(`Vec<${renderType(inner.element, false)}>`)
      case 'object':
        return wrap(objectNames.get(inner) ?? 'serde_json::Value')
    }
  }

  const blocks: string[] = ['use serde::{Deserialize, Serialize};']
  if (rootIr.kind !== 'object') {
    blocks.push(`pub type ${sanitizeTypeName(rootName)} = ${renderType(rootIr, false)};`)
  }
  for (const st of structs) {
    const usedFields = new Set<string>()
    const lines = ['#[derive(Debug, Clone, Serialize, Deserialize)]', `pub struct ${st.name} {`]
    for (const f of st.fields) {
      const rustField = safeFieldName(f.key, 'snake', 'rust', usedFields)
      const cleanName = rustField.replace(/^r#/, '')
      if (cleanName !== f.key) {
        lines.push(`    #[serde(rename = ${JSON.stringify(f.key)})]`)
      }
      lines.push(`    pub ${rustField}: ${renderType(f.type, f.optional)},`)
    }
    lines.push('}')
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

function renderPython(rootIr: IrType, rootName: string): string {
  const { structs, objectNames } = collectStructs(rootIr, rootName)

  const renderType = (t: IrType, optional: boolean): string => {
    const { inner, nullable } = unwrapNullable(t)
    const wrap = (base: string) => (optional || nullable ? `Optional[${base}]` : base)
    switch (inner.kind) {
      case 'any':
      case 'null':
        return 'Any'
      case 'boolean':
        return wrap('bool')
      case 'integer':
        return wrap('int')
      case 'number':
        return wrap('float')
      case 'string':
        return wrap('str')
      case 'array':
        return wrap(`list[${renderType(inner.element, false)}]`)
      case 'object':
        return wrap(objectNames.get(inner) ?? 'dict[str, Any]')
      case 'union': {
        const unionText = inner.members.map((m) => renderType(m, false)).join(' | ')
        return optional || nullable ? `${unionText} | None` : unionText
      }
    }
  }

  const blocks: string[] = [
    'from __future__ import annotations\nfrom dataclasses import dataclass\nfrom typing import Any, Optional',
  ]
  if (rootIr.kind !== 'object') {
    blocks.push(`${sanitizeTypeName(rootName)} = ${renderType(rootIr, false)}`)
  }
  for (const st of structs) {
    const lines = ['@dataclass', `class ${st.name}:`]
    if (st.fields.length === 0) {
      lines.push('    pass')
    } else {
      // Required fields first in Python dataclass, optional fields with default None after
      const usedFields = new Set<string>()
      const required = st.fields.filter((f) => !f.optional)
      const optional = st.fields.filter((f) => f.optional)
      for (const f of required) {
        const pyField = safeFieldName(f.key, 'snake', 'python', usedFields)
        lines.push(`    ${pyField}: ${renderType(f.type, false)}`)
      }
      for (const f of optional) {
        const pyField = safeFieldName(f.key, 'snake', 'python', usedFields)
        lines.push(`    ${pyField}: ${renderType(f.type, true)} = None`)
      }
    }
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

function renderKotlin(rootIr: IrType, rootName: string): string {
  const { structs, objectNames } = collectStructs(rootIr, rootName)

  const renderType = (t: IrType, optional: boolean): string => {
    const { inner, nullable } = unwrapNullable(t)
    const suffix = optional || nullable ? '?' : ''
    switch (inner.kind) {
      case 'any':
      case 'null':
      case 'union':
        return `Any${suffix}`
      case 'boolean':
        return `Boolean${suffix}`
      case 'integer':
        return `Long${suffix}`
      case 'number':
        return `Double${suffix}`
      case 'string':
        return `String${suffix}`
      case 'array':
        return `List<${renderType(inner.element, false)}>${suffix}`
      case 'object':
        return `${objectNames.get(inner) ?? 'Map<String, Any>'}${suffix}`
    }
  }

  const blocks: string[] = ['import kotlinx.serialization.SerialName\nimport kotlinx.serialization.Serializable']
  if (rootIr.kind !== 'object') {
    blocks.push(`typealias ${sanitizeTypeName(rootName)} = ${renderType(rootIr, false)}`)
  }
  for (const st of structs) {
    if (st.fields.length === 0) {
      blocks.push(`@Serializable\nclass ${st.name}`)
      continue
    }
    const usedFields = new Set<string>()
    const lines = ['@Serializable', `data class ${st.name}(`]
    st.fields.forEach((f, idx) => {
      const ktField = safeFieldName(f.key, 'camel', 'kotlin', usedFields)
      const cleanName = ktField.replace(/`/g, '')
      const comma = idx < st.fields.length - 1 ? ',' : ''
      const defaultVal = f.optional ? ' = null' : ''
      if (cleanName !== f.key) {
        lines.push(`    @SerialName(${JSON.stringify(f.key)})`)
      }
      lines.push(`    val ${ktField}: ${renderType(f.type, f.optional)}${defaultVal}${comma}`)
    })
    lines.push(')')
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

function renderSwift(rootIr: IrType, rootName: string): string {
  const { structs, objectNames } = collectStructs(rootIr, rootName)

  const renderType = (t: IrType, optional: boolean): string => {
    const { inner, nullable } = unwrapNullable(t)
    const suffix = optional || nullable ? '?' : ''
    switch (inner.kind) {
      case 'any':
      case 'null':
      case 'union':
        return `AnyCodable${suffix}`
      case 'boolean':
        return `Bool${suffix}`
      case 'integer':
        return `Int${suffix}`
      case 'number':
        return `Double${suffix}`
      case 'string':
        return `String${suffix}`
      case 'array':
        return `[${renderType(inner.element, false)}]${suffix}`
      case 'object':
        return `${objectNames.get(inner) ?? '[String: AnyCodable]'}${suffix}`
    }
  }

  const blocks: string[] = ['import Foundation']
  if (rootIr.kind !== 'object') {
    blocks.push(`typealias ${sanitizeTypeName(rootName)} = ${renderType(rootIr, false)}`)
  }
  for (const st of structs) {
    const usedFields = new Set<string>()
    const lines = [`struct ${st.name}: Codable {`]
    const mappedKeys: Array<{ prop: string; raw: string }> = []
    let needsCodingKeys = false
    for (const f of st.fields) {
      const prop = safeFieldName(f.key, 'camel', 'swift', usedFields)
      const cleanName = prop.replace(/`/g, '')
      if (cleanName !== f.key) needsCodingKeys = true
      mappedKeys.push({ prop, raw: f.key })
      lines.push(`    let ${prop}: ${renderType(f.type, f.optional)}`)
    }
    if (needsCodingKeys) {
      lines.push('')
      lines.push('    enum CodingKeys: String, CodingKey {')
      for (const mk of mappedKeys) {
        const cleanName = mk.prop.replace(/`/g, '')
        if (cleanName !== mk.raw) {
          lines.push(`        case ${mk.prop} = ${JSON.stringify(mk.raw)}`)
        } else {
          lines.push(`        case ${mk.prop}`)
        }
      }
      lines.push('    }')
    }
    lines.push('}')
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

function renderCSharp(rootIr: IrType, rootName: string): string {
  const { structs, objectNames } = collectStructs(rootIr, rootName)

  const renderType = (t: IrType, optional: boolean): string => {
    const { inner, nullable } = unwrapNullable(t)
    const suffix = optional || nullable ? '?' : ''
    switch (inner.kind) {
      case 'any':
      case 'null':
      case 'union':
        return `object${suffix}`
      case 'boolean':
        return `bool${suffix}`
      case 'integer':
        return `long${suffix}`
      case 'number':
        return `double${suffix}`
      case 'string':
        return `string${suffix}`
      case 'array':
        return `List<${renderType(inner.element, false)}>${suffix}`
      case 'object':
        return `${objectNames.get(inner) ?? 'Dictionary<string, object>'}${suffix}`
    }
  }

  const blocks: string[] = [
    'using System.Collections.Generic;\nusing System.Text.Json.Serialization;',
  ]
  if (rootIr.kind !== 'object' && structs.length === 0) {
    blocks.push(`public class ${sanitizeTypeName(rootName)}\n{\n    public ${renderType(rootIr, false)} Value { get; set; }\n}`)
  }
  for (const st of structs) {
    const usedFields = new Set<string>()
    const lines = [`public class ${st.name}`, '{']
    for (const f of st.fields) {
      const prop = safeFieldName(f.key, 'pascal', 'csharp', usedFields)
      lines.push(`    [JsonPropertyName(${JSON.stringify(f.key)})]`)
      lines.push(`    public ${renderType(f.type, f.optional)} ${prop} { get; set; }`)
    }
    lines.push('}')
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

function irToJsonSchema(type: IrType): Record<string, unknown> {
  switch (type.kind) {
    case 'any':
      return {}
    case 'null':
      return { type: 'null' }
    case 'boolean':
      return { type: 'boolean' }
    case 'integer':
      return { type: 'integer' }
    case 'number':
      return { type: 'number' }
    case 'string':
      return { type: 'string' }
    case 'array':
      return { type: 'array', items: irToJsonSchema(type.element) }
    case 'object': {
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const [k, f] of type.fields.entries()) {
        properties[k] = irToJsonSchema(f.type)
        if (!f.optional) required.push(k)
      }
      const schema: Record<string, unknown> = {
        type: 'object',
        properties,
      }
      if (required.length > 0) {
        schema.required = required
      }
      return schema
    }
    case 'union':
      return { anyOf: type.members.map(irToJsonSchema) }
  }
}

function renderJsonSchema(rootIr: IrType, rootName: string): string {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: sanitizeTypeName(rootName),
    ...irToJsonSchema(rootIr),
  }
  return JSON.stringify(schema, null, 2)
}

export function generateTypes(
  input: string,
  language: TargetLanguage,
  rootName = 'Root',
): string {
  const parsed = parseJsonLike(input)
  const rootIr = inferIr(parsed)
  const safeRoot = sanitizeTypeName(rootName || 'Root')

  switch (language) {
    case 'typescript':
      return renderTypeScript(rootIr, safeRoot)
    case 'go':
      return renderGo(rootIr, safeRoot)
    case 'java':
      return renderJava(rootIr, safeRoot)
    case 'rust':
      return renderRust(rootIr, safeRoot)
    case 'python':
      return renderPython(rootIr, safeRoot)
    case 'kotlin':
      return renderKotlin(rootIr, safeRoot)
    case 'swift':
      return renderSwift(rootIr, safeRoot)
    case 'csharp':
      return renderCSharp(rootIr, safeRoot)
    case 'jsonschema':
      return renderJsonSchema(rootIr, safeRoot)
  }
}
