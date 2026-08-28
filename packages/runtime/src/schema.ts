import { AgentRuntimeError } from './errors.js';
import { isJsonCompatible, isPlainRecord, jsonEquals } from './json.js';
import type { JsonObject, JsonSchema } from './types.js';

const MAX_SCHEMA_DEPTH = 16;
const MAX_SCHEMA_CHARACTERS = 16_000;
const JSON_SCHEMA_TYPES = new Set([
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string',
]);
const SUPPORTED_SCHEMA_KEYS = new Set([
  '$id',
  '$schema',
  'additionalProperties',
  'const',
  'default',
  'deprecated',
  'description',
  'enum',
  'examples',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'items',
  'maximum',
  'maxItems',
  'maxLength',
  'minimum',
  'minItems',
  'minLength',
  'properties',
  'readOnly',
  'required',
  'title',
  'type',
  'writeOnly',
]);

export function assertValidToolSchema(schema: JsonSchema, path = 'inputSchema'): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(schema);
  } catch {
    throw invalidTool(`${path} must be JSON-compatible.`);
  }
  if (serialized.length > MAX_SCHEMA_CHARACTERS) {
    throw new AgentRuntimeError('resource_limit', `${path} exceeded the schema size limit.`);
  }
  validateSchemaDefinition(schema, path, 0);
}

export function validateToolInput(input: JsonObject, schema: JsonSchema): void {
  validateSchemaDefinition(schema, 'input', 0);
  validateSchemaValue(input, schema, 'input', 0);
}

function validateSchemaDefinition(schema: JsonSchema, path: string, depth: number): void {
  if (!isPlainRecord(schema)) throw invalidTool(`${path} must be a schema object.`);
  if (depth > MAX_SCHEMA_DEPTH) {
    throw new AgentRuntimeError('resource_limit', `${path} exceeded the schema depth limit.`);
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      throw invalidTool(`${path} uses an unsupported JSON Schema keyword: ${key}`);
    }
  }
  if (schema.type !== undefined && (
    typeof schema.type !== 'string' || !JSON_SCHEMA_TYPES.has(schema.type)
  )) {
    throw invalidTool(`${path} uses an unsupported JSON Schema type.`);
  }
  if (schema.enum !== undefined && (
    !Array.isArray(schema.enum) || !schema.enum.every((entry) => isJsonCompatible(entry))
  )) {
    throw invalidTool(`${path} has an invalid enum.`);
  }
  if ('const' in schema && !isJsonCompatible(schema.const)) {
    throw invalidTool(`${path} has an invalid const value.`);
  }
  validateFiniteNumberKeyword(schema, 'minimum', path);
  validateFiniteNumberKeyword(schema, 'maximum', path);
  validateFiniteNumberKeyword(schema, 'exclusiveMinimum', path);
  validateFiniteNumberKeyword(schema, 'exclusiveMaximum', path);
  validateNonNegativeIntegerKeyword(schema, 'minLength', path);
  validateNonNegativeIntegerKeyword(schema, 'maxLength', path);
  validateNonNegativeIntegerKeyword(schema, 'minItems', path);
  validateNonNegativeIntegerKeyword(schema, 'maxItems', path);

  if (schema.required !== undefined && (
    !Array.isArray(schema.required)
    || schema.required.some((entry) => typeof entry !== 'string')
    || new Set(schema.required).size !== schema.required.length
  )) {
    throw invalidTool(`${path} has an invalid required list.`);
  }
  if (schema.properties !== undefined && !isPlainRecord(schema.properties)) {
    throw invalidTool(`${path} has invalid properties.`);
  }
  if (isPlainRecord(schema.properties)) {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (!isPlainRecord(childSchema)) throw invalidTool(`${path}.${key} must be a schema object.`);
      validateSchemaDefinition(childSchema, `${path}.${key}`, depth + 1);
    }
  }
  if (schema.additionalProperties !== undefined
    && typeof schema.additionalProperties !== 'boolean'
    && !isPlainRecord(schema.additionalProperties)) {
    throw invalidTool(`${path} has invalid additionalProperties.`);
  }
  if (isPlainRecord(schema.additionalProperties)) {
    validateSchemaDefinition(schema.additionalProperties, `${path}.*`, depth + 1);
  }
  if (schema.items !== undefined) {
    if (!isPlainRecord(schema.items)) throw invalidTool(`${path}.items must be a schema object.`);
    validateSchemaDefinition(schema.items, `${path}.items`, depth + 1);
  }
}

function validateSchemaValue(value: unknown, schema: JsonSchema, path: string, depth: number): void {
  if (depth > MAX_SCHEMA_DEPTH) {
    throw new AgentRuntimeError('resource_limit', `${path} exceeded the input depth limit.`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => jsonEquals(candidate, value))) {
    throw invalidInput(`${path} must match an allowed value.`);
  }
  if ('const' in schema && !jsonEquals(schema.const, value)) {
    throw invalidInput(`${path} must match the required value.`);
  }
  if (typeof schema.type === 'string' && !matchesJsonType(value, schema.type)) {
    throw invalidInput(`${path} must be ${schema.type}.`);
  }
  if (typeof value === 'string') validateString(value, schema, path);
  if (typeof value === 'number') validateNumber(value, schema, path);
  if (Array.isArray(value)) validateArray(value, schema, path, depth);
  if (isPlainRecord(value)) validateObject(value, schema, path, depth);
}

function validateObject(
  value: Record<string, unknown>,
  schema: JsonSchema,
  path: string,
  depth: number,
): void {
  const properties = isPlainRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required as string[] : [];
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw invalidInput(`${path}.${key} is required.`);
  }
  for (const [key, childValue] of Object.entries(value)) {
    const childSchema = properties[key];
    if (isPlainRecord(childSchema)) {
      validateSchemaValue(childValue, childSchema, `${path}.${key}`, depth + 1);
    } else if (schema.additionalProperties === false) {
      throw invalidInput(`${path}.${key} is not allowed.`);
    } else if (isPlainRecord(schema.additionalProperties)) {
      validateSchemaValue(childValue, schema.additionalProperties, `${path}.${key}`, depth + 1);
    }
  }
}

function validateArray(value: unknown[], schema: JsonSchema, path: string, depth: number): void {
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
    throw invalidInput(`${path} requires at least ${schema.minItems} items.`);
  }
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
    throw invalidInput(`${path} allows at most ${schema.maxItems} items.`);
  }
  if (isPlainRecord(schema.items)) {
    value.forEach((item, index) => validateSchemaValue(item, schema.items as JsonSchema, `${path}[${index}]`, depth + 1));
  }
}

function validateString(value: string, schema: JsonSchema, path: string): void {
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    throw invalidInput(`${path} must contain at least ${schema.minLength} characters.`);
  }
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    throw invalidInput(`${path} must contain at most ${schema.maxLength} characters.`);
  }
}

function validateNumber(value: number, schema: JsonSchema, path: string): void {
  if (!Number.isFinite(value)) throw invalidInput(`${path} must be finite.`);
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    throw invalidInput(`${path} must be at least ${schema.minimum}.`);
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    throw invalidInput(`${path} must be at most ${schema.maximum}.`);
  }
  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
    throw invalidInput(`${path} must be greater than ${schema.exclusiveMinimum}.`);
  }
  if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
    throw invalidInput(`${path} must be less than ${schema.exclusiveMaximum}.`);
  }
}

function matchesJsonType(value: unknown, type: string): boolean {
  if (type === 'object') return isPlainRecord(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function validateFiniteNumberKeyword(schema: JsonSchema, key: string, path: string): void {
  const value = schema[key];
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw invalidTool(`${path}.${key} must be a finite number.`);
  }
}

function validateNonNegativeIntegerKeyword(schema: JsonSchema, key: string, path: string): void {
  const value = schema[key];
  if (value !== undefined && (
    typeof value !== 'number' || !Number.isInteger(value) || value < 0
  )) {
    throw invalidTool(`${path}.${key} must be a non-negative integer.`);
  }
}

function invalidInput(message: string): AgentRuntimeError {
  return new AgentRuntimeError('invalid_tool_input', message);
}

function invalidTool(message: string): AgentRuntimeError {
  return new AgentRuntimeError('invalid_tool', message);
}
