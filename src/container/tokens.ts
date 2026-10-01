export class AlsToken<T = any> {
   readonly __brand = 'diject:als_token' as const;
   constructor(public readonly key: string) {}

   static isAlsToken(token: any): token is AlsToken {
      return token?.__brand === 'diject:als_token';
   }
}

export function createAlsToken<T = any>(key: string): AlsToken<T> {
   return new AlsToken<T>(key);
}

