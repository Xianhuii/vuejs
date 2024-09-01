import { extend, isArray, isIntegerKey, isMap, isSymbol } from '@vue/shared'
import type { ComputedRefImpl } from './computed'
import { type TrackOpTypes, TriggerOpTypes } from './constants'
import {
  type DebuggerEventExtraInfo,
  EffectFlags,
  type Link,
  activeSub,
  endBatch,
  shouldTrack,
  startBatch,
} from './effect'

/**
 * Incremented every time a reactive change happens
 * This is used to give computed a fast path to avoid re-compute when nothing
 * has changed.
 */
export let globalVersion = 0

/**
 * @internal
 */
export class Dep {
  version = 0
  /**
   * Link between this dep and the current active effect
   */
  activeLink?: Link = undefined

  /**
   * Doubly linked list representing the subscribing effects (tail)
   */
  subs?: Link = undefined

  /**
   * Doubly linked list representing the subscribing effects (head)
   * DEV only, for invoking onTrigger hooks in correct order
   */
  subsHead?: Link

  constructor(public computed?: ComputedRefImpl | undefined) {
    if (__DEV__) {
      this.subsHead = undefined
    }
  }

  track(debugInfo?: DebuggerEventExtraInfo): Link | undefined { // jxh: 收集响应属性的副作用函数
    if (!activeSub || !shouldTrack) {
      return
    }

    let link = this.activeLink
    if (link === undefined /* jxh: 第一次收集副作用函数 */ || link.sub !== activeSub) {
      link = this.activeLink = { // jxh: 创建link
        dep: this,
        sub: activeSub, // jxh: 副作用函数
        version: this.version,
        nextDep: undefined,
        prevDep: undefined,
        nextSub: undefined,
        prevSub: undefined,
        prevActiveLink: undefined,
      }

      // add the link to the activeEffect as a dep (as tail) // jxh: 添加副作用函数到activeEffect链表
      if (!activeSub.deps) {
        activeSub.deps = activeSub.depsTail = link
      } else {
        link.prevDep = activeSub.depsTail
        activeSub.depsTail!.nextDep = link
        activeSub.depsTail = link
      }

      if (activeSub.flags & EffectFlags.TRACKING) {
        addSub(link)
      }
    } else if (link.version === -1) {
      // reused from last run - already a sub, just sync version
      link.version = this.version

      // If this dep has a next, it means it's not at the tail - move it to the
      // tail. This ensures the effect's dep list is in the order they are
      // accessed during evaluation.
      if (link.nextDep) {
        const next = link.nextDep
        next.prevDep = link.prevDep
        if (link.prevDep) {
          link.prevDep.nextDep = next
        }

        link.prevDep = activeSub.depsTail
        link.nextDep = undefined
        activeSub.depsTail!.nextDep = link
        activeSub.depsTail = link

        // this was the head - point to the new head
        if (activeSub.deps === link) {
          activeSub.deps = next
        }
      }
    }

    if (__DEV__ && activeSub.onTrack) {
      activeSub.onTrack(
        extend(
          {
            effect: activeSub,
          },
          debugInfo,
        ),
      )
    }

    return link
  }

  trigger(debugInfo?: DebuggerEventExtraInfo): void {
    this.version++
    globalVersion++
    this.notify(debugInfo)
  }

  notify(debugInfo?: DebuggerEventExtraInfo): void { // jxh: 通知副作用函数
    startBatch()
    try {
      if (__DEV__) {
        // subs are notified and batched in reverse-order and then invoked in
        // original order at the end of the batch, but onTrigger hooks should
        // be invoked in original order here.
        for (let head = this.subsHead; head; head = head.nextSub) {
          if (
            __DEV__ &&
            head.sub.onTrigger &&
            !(head.sub.flags & EffectFlags.NOTIFIED)
          ) {
            head.sub.onTrigger(
              extend(
                {
                  effect: head.sub,
                },
                debugInfo,
              ),
            )
          }
        }
      }
      for (let link = this.subs; link; link = link.prevSub) {
        link.sub.notify() // jxh: 通知订阅者（设置副作用函数）
      }
    } finally {
      endBatch() // jxh: 触发副作用函数
    }
  }
}

function addSub(link: Link) {
  const computed = link.dep.computed
  // computed getting its first subscriber
  // enable tracking + lazily subscribe to all its deps
  if (computed && !link.dep.subs) {
    computed.flags |= EffectFlags.TRACKING | EffectFlags.DIRTY
    for (let l = computed.deps; l; l = l.nextDep) {
      addSub(l)
    }
  }

  const currentTail = link.dep.subs
  if (currentTail !== link) {
    link.prevSub = currentTail
    if (currentTail) currentTail.nextSub = link
  }

  if (__DEV__ && link.dep.subsHead === undefined) {
    link.dep.subsHead = link
  }

  link.dep.subs = link
}

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Maps to reduce memory overhead.
type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<object, KeyToDepMap>()

export const ITERATE_KEY: unique symbol = Symbol(
  __DEV__ ? 'Object iterate' : '',
)
export const MAP_KEY_ITERATE_KEY: unique symbol = Symbol(
  __DEV__ ? 'Map keys iterate' : '',
)
export const ARRAY_ITERATE_KEY: unique symbol = Symbol(
  __DEV__ ? 'Array iterate' : '',
)

/**
 * Tracks access to a reactive property.
 *
 * This will check which effect is running at the moment and record it as dep
 * which records all effects that depend on the reactive property.
 *
 * @param target - Object holding the reactive property.
 * @param type - Defines the type of access to the reactive property.
 * @param key - Identifier of the reactive property to track.
 */
export function track(target: object, type: TrackOpTypes, key: unknown): void { // jxh: 收集响应式对象的响应属性
  if (shouldTrack && activeSub) {
    let depsMap = targetMap.get(target)
    if (!depsMap) {
      targetMap.set(target, (depsMap = new Map())) // jxh: 如果depsMap为空，新建空Map
    }
    let dep = depsMap.get(key)
    if (!dep) {
      depsMap.set(key, (dep = new Dep())) // jxh: 如果属性对应dep为空，新建dep
    }
    if (__DEV__) {
      dep.track({
        target,
        type,
        key,
      })
    } else {
      dep.track() // jxh: 收集响应属性的副作用函数
    }
  }
}

/**
 * Finds all deps associated with the target (or a specific property) and
 * triggers the effects stored within.
 *
 * @param target - The reactive object.
 * @param type - Defines the type of the operation that needs to trigger effects.
 * @param key - Can be used to target a specific reactive property in the target object.
 */
export function trigger( // jxh: 触发副作用函数
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>,
): void {
  const depsMap = targetMap.get(target) // jxh: 获取代理目标对象的副作用函数集合
  if (!depsMap) {
    // never been tracked
    globalVersion++
    return
  }

  let deps: Dep[] = [] // jxh: 待执行的副作用函数
  if (type === TriggerOpTypes.CLEAR) { // jxh: 获取所有副作用函数
    // collection being cleared
    // trigger all effects for target
    deps = [...depsMap.values()]
  } else {
    const targetIsArray = isArray(target)
    const isArrayIndex = targetIsArray && isIntegerKey(key)

    if (targetIsArray && key === 'length') { // jxh: 获取length的副作用函数
      const newLength = Number(newValue)
      depsMap.forEach((dep, key) => {
        if (
          key === 'length' ||
          key === ARRAY_ITERATE_KEY ||
          (!isSymbol(key) && key >= newLength)
        ) {
          deps.push(dep)
        }
      })
    } else {
      const push = (dep: Dep | undefined) => dep && deps.push(dep)

      // schedule runs for SET | ADD | DELETE
      if (key !== void 0) {
        push(depsMap.get(key))
      }

      // schedule ARRAY_ITERATE for any numeric key change (length is handled above)
      if (isArrayIndex) {
        push(depsMap.get(ARRAY_ITERATE_KEY))
      }

      // also run for iteration key on ADD | DELETE | Map.SET
      switch (type) {
        case TriggerOpTypes.ADD:
          if (!targetIsArray) {
            push(depsMap.get(ITERATE_KEY))
            if (isMap(target)) {
              push(depsMap.get(MAP_KEY_ITERATE_KEY))
            }
          } else if (isArrayIndex) {
            // new index added to array -> length changes
            push(depsMap.get('length'))
          }
          break
        case TriggerOpTypes.DELETE:
          if (!targetIsArray) {
            push(depsMap.get(ITERATE_KEY))
            if (isMap(target)) {
              push(depsMap.get(MAP_KEY_ITERATE_KEY))
            }
          }
          break
        case TriggerOpTypes.SET:
          if (isMap(target)) {
            push(depsMap.get(ITERATE_KEY))
          }
          break
      }
    }
  }

  startBatch()
  for (const dep of deps) { // jxh: 遍历触发副作用函数
    if (__DEV__) {
      dep.trigger({
        target,
        type,
        key,
        newValue,
        oldValue,
        oldTarget,
      })
    } else {
      dep.trigger()
    }
  }
  endBatch()
}

/**
 * Test only
 */
export function getDepFromReactive(
  object: any,
  key: string | number | symbol,
): Dep | undefined {
  // eslint-disable-next-line
  return targetMap.get(object)?.get(key)
}
