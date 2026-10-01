// ============================================================================
// keys.ts - Centralized metadata keys
// ============================================================================
// Location: @najm/di/src/decorators/keys.ts
// ============================================================================

// ============================================================================
// CORE KEYS (class-level)
// ============================================================================

/** Marks a class as injectable */
export const INJECTABLE = Symbol.for('diject:injectable');

/** Scope of the injectable (singleton, transient, request) */
export const SCOPE = Symbol.for('diject:scope');

/** Type category: 'service' | 'controller' | 'repository' | etc. */
export const CLASS_TYPE = Symbol.for('diject:class_type');

/** Custom metadata attached via @Meta() */
export const METADATA = Symbol.for('diject:metadata');

// ============================================================================
// DECORATOR-SPECIFIC KEYS
// ============================================================================

/** @Service marker */
export const SERVICE = Symbol.for('diject:service');

/** @Controller marker */
export const CONTROLLER = Symbol.for('diject:controller');

/** @Controller path */
export const CONTROLLER_PATH = Symbol.for('diject:controller_path');

/** @Repository marker */
export const REPOSITORY = Symbol.for('diject:repository');

/** @Repository database name */
export const DATABASE = Symbol.for('diject:database');

// ============================================================================
// INJECTION KEYS
// ============================================================================

/** Property injection metadata */
export const INJECT_PROPS = Symbol.for('diject:inject_props');

/** Constructor parameter injection metadata */
export const INJECT_PARAMS = Symbol.for('diject:inject_params');

/** @Scan property decorator metadata */
export const SCAN_PROPS = Symbol.for('diject:scan_props');



// ============================================================================
// REFLECT-METADATA DESIGN KEYS
// ============================================================================

export const DESIGN_PARAMTYPES = 'design:paramtypes';
export const DESIGN_TYPE = 'design:type';
export const DESIGN_RETURNTYPE = 'design:returntype';
