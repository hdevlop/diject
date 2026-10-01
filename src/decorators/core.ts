// ============================================================================
// core.ts - Shared class-level metadata utilities
// ============================================================================
// Location: @najm/di/src/decorators/core.ts
// ============================================================================

import { Scope } from '../container/helpers';
import { MetaHelper } from './MetaHelper';
import { INJECTABLE, SCOPE, CLASS_TYPE, METADATA } from './keys';
import { DecoratorMetadata } from './types';

// ============================================================================
// CLASS TYPE (used by @Service, @Controller, @Repository)
// ============================================================================

/**
 * Get the class type set by decorators
 * Returns: 'service' | 'controller' | 'repository' | undefined
 */
export function getClassType(target: Function): string | undefined {
   return MetaHelper.get<string>(CLASS_TYPE, target);
}

/**
 * @internal Used by decorators to set class type
 */
export function setClassType(target: Function, type: string): void {
   MetaHelper.define(CLASS_TYPE, type, target);
}

// ============================================================================
// INJECTABLE (used by all class decorators)
// ============================================================================

export function isInjectable(target: Function): boolean {
   return MetaHelper.get<boolean>(INJECTABLE, target) === true;
}

/**
 * @internal
 */
export function setInjectable(target: Function, value: boolean = true): void {
   MetaHelper.define(INJECTABLE, value, target);
}

// ============================================================================
// SCOPE (used by all class decorators)
// ============================================================================

export function getScope(target: Function): Scope {
   return MetaHelper.get<Scope>(SCOPE, target) ?? Scope.SINGLETON;
}

/**
 * @internal
 */
export function setScope(target: Function, scope: Scope): void {
   MetaHelper.define(SCOPE, scope, target);
}

// ============================================================================
// METADATA (used by @Meta and all decorators with metadata option)
// ============================================================================

export function getDecoratorMetadata(target: Function): DecoratorMetadata {
   return MetaHelper.get<DecoratorMetadata>(METADATA, target) ?? {};
}

export function hasDecoratorMetadata(target: Function, key: string): boolean {
   const meta = MetaHelper.get<DecoratorMetadata>(METADATA, target);
   return meta != null && key in meta;
}

export function getDecoratorMetadataValue<T = any>(target: Function, key: string): T | undefined {
   const meta = MetaHelper.get<DecoratorMetadata>(METADATA, target);
   return meta?.[key];
}

/**
 * @internal
 */
export function mergeMetadata(target: Function, metadata: DecoratorMetadata): void {
   MetaHelper.merge(METADATA, metadata, target);
}
