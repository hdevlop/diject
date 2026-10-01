import { Metadata, MetadataQuery, Token } from "./types";
import { compareValues } from "./helpers";

const hasOwn = (obj: object, key: string): boolean =>
   Object.prototype.hasOwnProperty.call(obj, key);

export class MetadataManager {
   // Metadata lives beside the registry, never on registered values, so
   // user-owned objects (named values, instances, injection data) are not mutated.
   private store = new Map<Token, Metadata>();

   // Secondary indexes for fast lookups
   private keyIndex = new Map<string, Set<Token>>();
   private valueIndex = new Map<string, Map<any, Set<Token>>>();

   constructor(private registry: Map<Token, any>) {}

   // ============================================
   // SET METADATA (with indexing)
   // ============================================

   set(token: Token, key: string, value: any): void;
   set(token: Token, metadata: Metadata): void;
   set(token: Token, keyOrMetadata: string | Metadata, value?: any): void {
      // Metadata only attaches to registered tokens
      if (!this.registry.has(token)) return;

      let metadata = this.store.get(token);
      if (!metadata) {
         metadata = {};
         this.store.set(token, metadata);
      }

      if (typeof keyOrMetadata === 'string') {
         this.updateIndexes(token, metadata, keyOrMetadata, value);
         metadata[keyOrMetadata] = value;
      } else {
         for (const [key, val] of Object.entries(keyOrMetadata)) {
            this.updateIndexes(token, metadata, key, val);
            metadata[key] = val;
         }
      }
   }

   private updateIndexes(token: Token, oldMetadata: Metadata, key: string, newValue: any): void {
      const oldValue = oldMetadata[key];

      // Remove from old value index
      if (hasOwn(oldMetadata, key)) {
         this.removeValueIndex(key, oldValue, token);
      }

      // Add to key index
      if (!this.keyIndex.has(key)) {
         this.keyIndex.set(key, new Set());
      }
      this.keyIndex.get(key)!.add(token);

      // Add to value index
      if (!this.valueIndex.has(key)) {
         this.valueIndex.set(key, new Map());
      }
      const keyValues = this.valueIndex.get(key)!;
      if (!keyValues.has(newValue)) {
         keyValues.set(newValue, new Set());
      }
      keyValues.get(newValue)!.add(token);
   }

   // ============================================
   // GET METADATA
   // ============================================

   get(token: Token, key?: string): any {
      const metadata = this.store.get(token);
      if (!metadata) return key ? undefined : {};
      if (!key) return { ...metadata };
      return hasOwn(metadata, key) ? metadata[key] : undefined;
   }

   has(token: Token, key: string): boolean {
      const metadata = this.store.get(token);
      return metadata !== undefined && hasOwn(metadata, key);
   }

   // ============================================
   // DELETE METADATA (with index cleanup)
   // ============================================

   delete(token: Token, key: string): void {
      const metadata = this.store.get(token);
      if (!metadata || !hasOwn(metadata, key)) return;

      this.removeKeyIndex(key, token);
      this.removeValueIndex(key, metadata[key], token);

      delete metadata[key];
   }

   clear(token: Token): void {
      this.removeToken(token);
   }

   // ============================================
   // OPTIMIZED QUERY SYSTEM
   // ============================================

   find(query: MetadataQuery): Token[] {
      const { filters, sortKey, sortDir } = this.parseQuery(query);
      let tokens = this.findTokens(filters);

      if (sortKey) {
         tokens = this.sortTokens(tokens, sortKey, sortDir);
      }

      return tokens;
   }

   private parseQuery(query: MetadataQuery): {
      filters: Record<string, any>;
      sortKey?: string;
      sortDir: 'asc' | 'desc';
   } {
      const filters: Record<string, any> = {};
      let sortKey: string | undefined;
      let sortDir: 'asc' | 'desc' = 'asc';

      for (const [key, value] of Object.entries(query)) {
         if (key === '$sort' && typeof value === 'object' && value !== null) {
            const sortObj = value as Record<string, string>;
            const sortEntry = Object.entries(sortObj)[0];
            if (sortEntry) {
               sortKey = sortEntry[0];
               sortDir = sortEntry[1] === 'desc' ? 'desc' : 'asc';
            }
         } else if (key !== '$sort') {
            filters[key] = value;
         }
      }

      return { filters, sortKey, sortDir };
   }

   private findTokens(filters: Record<string, any>): Token[] {
      const entries = Object.entries(filters);

      if (entries.length === 0) {
         return [];
      }

      const canUseIndex = entries.every(([_, v]) => typeof v !== 'function');

      if (canUseIndex && entries.length === 1) {
         const [key, value] = entries[0];
         const tokens = this.valueIndex.get(key)?.get(value);
         return tokens ? Array.from(tokens) : [];
      }

      if (canUseIndex && entries.length > 1) {
         return this.findByIntersection(entries);
      }

      return this.findByScan(filters);
   }

   private findByIntersection(queryEntries: [string, any][]): Token[] {
      const sets = queryEntries
         .map(([key, value]) => this.valueIndex.get(key)?.get(value))
         .filter((set): set is Set<Token> => set != null && set.size > 0)
         .sort((a, b) => a.size - b.size);

      if (sets.length !== queryEntries.length) {
         return [];
      }

      const [smallest, ...rest] = sets;
      const result: Token[] = [];

      for (const token of smallest) {
         if (rest.every(set => set.has(token))) {
            result.push(token);
         }
      }

      return result;
   }

   private findByScan(filters: Record<string, any>): Token[] {
      const tokens: Token[] = [];

      // Walk the registry (not the store) to keep registration order
      for (const token of this.registry.keys()) {
         const metadata = this.store.get(token);
         if (!metadata) continue;
         if (this.matches(metadata, filters)) {
            tokens.push(token);
         }
      }

      return tokens;
   }

   private sortTokens(tokens: Token[], key: string, direction: 'asc' | 'desc'): Token[] {
      return [...tokens].sort((a, b) => {
         const order = compareValues(this.get(a, key) ?? 0, this.get(b, key) ?? 0);
         return direction === 'asc' ? order : -order;
      });
   }

   findByKey(key: string): Token[] {
      const tokens = this.keyIndex.get(key);
      return tokens ? Array.from(tokens) : [];
   }

   getValues(key: string): Set<any> {
      const keyValues = this.valueIndex.get(key);
      return keyValues ? new Set(keyValues.keys()) : new Set();
   }

   groupBy(key: string): Map<any, Token[]> {
      const keyValues = this.valueIndex.get(key);
      if (!keyValues) return new Map();

      const groups = new Map<any, Token[]>();
      for (const [value, tokens] of keyValues) {
         if (tokens.size > 0) {
            groups.set(value, Array.from(tokens));
         }
      }
      return groups;
   }

   filter(predicate: (metadata: Metadata, token: Token) => boolean): Token[] {
      const tokens: Token[] = [];

      for (const token of this.registry.keys()) {
         const metadata = this.store.get(token);
         if (!metadata) continue;
         if (predicate(metadata, token)) {
            tokens.push(token);
         }
      }

      return tokens;
   }

   // ============================================
   // HELPERS
   // ============================================

   private matches(metadata: Metadata, query: Record<string, any>): boolean {
      for (const key in query) {
         const expected = query[key];
         const actual = hasOwn(metadata, key) ? metadata[key] : undefined;

         if (typeof expected === 'function') {
            if (!expected(actual)) return false;
         } else if (actual !== expected) {
            return false;
         }
      }
      return true;
   }

   // ============================================
   // BULK OPERATIONS
   // ============================================

   bulkSet(tokens: Token[], metadata: Metadata): void {
      for (const token of tokens) {
         this.set(token, metadata);
      }
   }

   copy(from: Token, to: Token): void {
      const metadata = this.get(from);
      if (Object.keys(metadata).length > 0) {
         this.set(to, metadata);
      }
   }

   // ============================================
   // INDEX MAINTENANCE (called when token is deleted or re-registered)
   // ============================================

   removeToken(token: Token): void {
      const metadata = this.store.get(token);
      if (!metadata) return;

      for (const [key, value] of Object.entries(metadata)) {
         this.removeKeyIndex(key, token);
         this.removeValueIndex(key, value, token);
      }
      this.store.delete(token);
   }

   private removeKeyIndex(key: string, token: Token): void {
      const tokens = this.keyIndex.get(key);
      tokens?.delete(token);
      if (tokens?.size === 0) this.keyIndex.delete(key);
   }

   private removeValueIndex(key: string, value: any, token: Token): void {
      const values = this.valueIndex.get(key);
      const tokens = values?.get(value);
      tokens?.delete(token);
      if (tokens?.size === 0) values?.delete(value);
      if (values?.size === 0) this.valueIndex.delete(key);
   }

   /** Drop all metadata and indexes (used during full container reset). */
   clearIndexes(): void {
      this.store.clear();
      this.keyIndex.clear();
      this.valueIndex.clear();
   }
}
