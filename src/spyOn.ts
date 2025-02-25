import {
  createInternalSpy,
  populateSpy,
  spies,
  SpyImpl,
  SpyInternalImpl,
} from './internal'
import { assert, define, defineValue, isType } from './utils'
import { S } from './constants'

type Procedure = (...args: any[]) => any

type Methods<T> = {
  [K in keyof T]: T[K] extends Procedure ? K : never
}[keyof T]
type Getters<T> = {
  [K in keyof T]: T[K] extends Procedure ? never : K
}[keyof T]
type Constructors<T> = {
  [K in keyof T]: T[K] extends new (...args: any[]) => any ? K : never
}[keyof T]

let getDescriptor = (obj: any, method: string | symbol | number) =>
  Object.getOwnPropertyDescriptor(obj, method)

export function internalSpyOn<T, K extends string & keyof T>(
  obj: T,
  methodName: K | { getter: K } | { setter: K },
  mock?: Procedure
): SpyInternalImpl<any[], any> {
  assert(
    !isType('undefined', obj),
    'spyOn could not find an object to spy upon'
  )

  assert(
    isType('object', obj) || isType('function', obj),
    'cannot spyOn on a primitive value'
  )

  let getMeta = (): [string | symbol | number, 'value' | 'get' | 'set'] => {
    if (!isType('object', methodName)) {
      return [methodName, 'value']
    }
    if ('getter' in methodName && 'setter' in methodName) {
      throw new Error('cannot spy on both getter and setter')
    }
    if ('getter' in methodName) {
      return [methodName.getter, 'get']
    }
    if ('setter' in methodName) {
      return [methodName.setter, 'set']
    }
    throw new Error('specify getter or setter to spy on')
  }

  let [accessName, accessType] = getMeta()
  let objDescriptor = getDescriptor(obj, accessName)
  let proto = Object.getPrototypeOf(obj)
  let protoDescriptor = proto && getDescriptor(proto, accessName)
  let descriptor = objDescriptor || protoDescriptor

  assert(
    descriptor || accessName in obj,
    `${String(accessName)} does not exist`
  )

  let ssr = false

  // vite ssr support - actual function is stored inside a getter
  if (
    accessType === 'value' &&
    descriptor &&
    !descriptor.value &&
    descriptor.get
  ) {
    accessType = 'get'
    ssr = true
    mock = descriptor.get!()
  }

  let origin: Procedure

  if (descriptor) {
    origin = descriptor[accessType]
  } else if (accessType !== 'value') {
    origin = () => obj[accessName as keyof T]
  } else {
    origin = obj[accessName as keyof T] as unknown as Procedure
  }

  if (!mock) mock = origin

  let fn = createInternalSpy(mock)
  let reassign = (cb: any) => {
    let { value, ...desc } = descriptor || {
      configurable: true,
      writable: true,
    }
    if (accessType !== 'value') {
      delete desc.writable // getter/setter can't have writable attribute at all
    }
    ;(desc as PropertyDescriptor)[accessType] = cb
    define(obj, accessName, desc)
  }
  let restore = () => reassign(origin)
  const state = fn[S]
  defineValue(state, 'restore', restore)
  defineValue(state, 'getOriginal', () => (ssr ? origin() : origin))
  defineValue(state, 'willCall', (newCb: Procedure) => {
    state.impl = newCb
    return fn
  })

  reassign(ssr ? () => fn : fn)

  spies.add(fn as any)
  return fn as any
}

// setters exist without getter, so we can check only getters
export function spyOn<T, S extends Getters<Required<T>>>(
  obj: T,
  methodName: { setter: S },
  mock?: (arg: T[S]) => void
): SpyImpl<[T[S]], void>
export function spyOn<T, G extends Getters<Required<T>>>(
  obj: T,
  methodName: { getter: G },
  mock?: () => T[G]
): SpyImpl<[], T[G]>
export function spyOn<T, M extends Constructors<Required<T>>>(
  object: T,
  method: M
): Required<T>[M] extends new (...args: infer A) => infer R
  ? SpyImpl<A, R>
  : never
export function spyOn<T, M extends Methods<Required<T>>>(
  obj: T,
  methodName: M,
  mock?: T[M]
): Required<T>[M] extends (...args: infer A) => infer R ? SpyImpl<A, R> : never
export function spyOn<T extends object, K extends string & keyof T>(
  obj: T,
  methodName: K | { getter: K } | { setter: K },
  mock?: Procedure
): SpyImpl<any[], any> {
  const spy = internalSpyOn(obj, methodName, mock)
  populateSpy(spy)
  ;(['restore', 'getOriginal', 'willCall'] as const).forEach((method) => {
    defineValue(spy, method, spy[S][method])
  })
  return spy as any as SpyImpl
}
