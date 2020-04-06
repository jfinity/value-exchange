// const sourceDisqualifier = "{ [native code] }";
const sourceDisqualifier = String(class {}.constructor).replace(/^[^{]*/, "");

// // TODO: consider improving with new Error().stack(? and https://v8.dev/docs/stack-trace-api)
export function callback() {
  const THIS = this;
  const scopedRefsThenFn = Array.apply(null, arguments);

  let failed = false;
  let done = false;

  let at = 0;

  const it = {
    next: function (value) {
      at = failed || done ? -1 : at;
      switch (at) {
        case 0: {
          at += 1;
          return { value: [THIS].concat(scopedRefsThenFn), done: false };
        }
        case 1: {
          at += 1;
          return { value: value[scopedRefsThenFn.length], done: true };
        }
        default: {
          done = true;
          return { value: undefined, done };
        }
      }
    },
    return: function (value) {
      done = true;
      return { value, done };
    },
    throw: function (err) {
      failed = true;
      throw err;
    },
  };

  if (typeof Symbol === "function") {
    it[Symbol.iterator] = function () {
      return it;
    };
  }

  return it;
}
// export function* callback(...scopedRefsThenFn) {
//   return (yield [this].concat(scopedRefsThenFn))[scopedRefsThenFn.length];
// }

export function memo() {
  const THIS = this;
  const scopedRefsThenFn = Array.apply(null, arguments);

  let failed = false;
  let done = false;

  const result = [];
  function handler() {
    if (result.length) return result[0];

    return (result[0] = scopedRefsThenFn[scopedRefsThenFn.length - 1].apply(
      this,
      arguments
    ));
  }

  const gen = callback.apply(THIS, scopedRefsThenFn.concat([handler]));

  const it = {
    next: function (value) {
      if (failed || done) {
        return { value: undefined, done: true };
      }

      const temp = gen.next(value);

      if (!temp.done) {
        return temp;
      } else {
        done = true;
        return {
          value: temp.value.apply(THIS, scopedRefsThenFn.slice(0, -1)),
          done,
        };
      }
    },
    return: function (value) {
      done = true;
      return gen.return(value);
    },
    throw: function (err) {
      try {
        return gen.throw(err); // TODO: check this for correctness...
      } catch (die) {
        failed = true;
        throw die;
      }
    },
  };

  if (typeof Symbol === "function") {
    it[Symbol.iterator] = function () {
      return it;
    };
  }

  return it;
}
// export function* memo(...scopedRefsThenFn) {
//   const result = [];
//   function handler() {
//     if (result.length) return result[0];

//     return (result[0] = scopedRefsThenFn[scopedRefsThenFn.length - 1].apply(
//       this,
//       arguments
//     ));
//   }

//   return (yield* callback.apply(
//     this,
//     scopedRefsThenFn.concat([handler])
//   )).apply(this, scopedRefsThenFn.slice(0, -1));
// }

function spreadEntries(value, key) {
  this.push([key, value]);
}

function spreadValues(value) {
  this.push(value);
}

export class ValueExchange {
  static allocStorage() {
    return {
      referencesByValue: new Map(),
      functionWithSource: {},
      objectsByKeyCount: {},
      arraysByLength: {},
      mapsBySize: {},
      setsBySize: {},
    };
  }

  constructor() {
    this.buffers = new Array(2).fill(ValueExchange.allocStorage());
  }

  clone() {
    const duplicate = new ValueExchange();
    // TODO: consider the implications of sharing (even temporarily) mutating state
    // (does it matter if you swap in a similar value from a different exchange?)
    duplicate.sweep().buffers[0] = this.buffers[0];
    return duplicate;
  }

  sweep() {
    this.buffers[0] = this.buffers[1]; // stale
    this.buffers[1] = ValueExchange.allocStorage(); // fresh
    return this;
  }

  handle(generator) {
    let result =
      typeof (generator && generator.next) === "function"
        ? generator.next()
        : { value: generator, done: true };

    while (!result.done) {
      result = generator.next(this.memoized(result.value));
    }

    return result.value;
  }

  memoized(value) {
    if (this.buffers[1].referencesByValue.has(value)) {
      return value;
    }

    let hit = this.buffers[0].referencesByValue.get(value);

    switch (typeof (value || undefined)) {
      default: {
        return value;
      }

      case "function": {
        if (!hit) {
          const code = value.toString();

          if (sourceDisqualifier === code.trim().slice(-sourceDisqualifier)) {
            return value; // ignore code.trim().endsWith("{ [native code] }")
          }

          hit = this.buffers[0].functionWithSource[code] || { value, code };
          this.buffers[0].functionWithSource[code] = hit;
          this.buffers[0].referencesByValue.set(value, hit);
        }

        // mark
        this.buffers[1].functionWithSource[code] = hit;
        this.buffers[1].referencesByValue.set(value, hit);
        return hit.value;
      }

      case "object": {
        if (!hit) {
          let stale, name, pairwise, entries;

          if (Array.isArray(value)) {
            stale = this.buffers[0].arraysByLength;
            name = "arraysByLength";
            pairwise = false;
            entries = value;
          } else if (value instanceof Map) {
            stale = this.buffers[0].mapsBySize;
            name = "mapsBySize";
            pairwise = true;
            entries = new Array(value.size);

            entries.fill(entries);
            while (entries.length) entries.pop();
            value.forEach(spreadEntries, entries);
          } else if (value instanceof Set) {
            stale = this.buffers[0].setsBySize;
            name = "setsBySize";
            pairwise = false;
            entries = new Array(value.size);

            entries.fill(entries);
            while (entries.length) entries.pop();
            value.forEach(spreadValues, entries);
          } else {
            stale = this.buffers[0].objectsByKeyCount;
            name = "objectsByKeyCount";
            pairwise = true;
            entries = Object.keys(value).sort();

            for (let index = 0; index < entries.length; index += 1) {
              entries[index] = [entries[index], value[entries[index]]];
            }
          }

          const list = stale[entries.length] || (stale[entries.length] = []);

          for (let index = 0; index < list.length; index += 1) {
            if (this.relateArrays(entries, list[index].entries, pairwise)) {
              hit = list[index];
              break;
            }
          }

          if (!hit) {
            hit = { value, name, entries };
            list.push(hit);
            this.buffers[0].referencesByValue.set(value, hit);
          }
        }

        const other =
          this.buffers[1][hit.name][hit.entries.length] ||
          (this.buffers[1][hit.name][hit.entries.length] = []);

        // mark
        other.push(hit);
        this.buffers[1].referencesByValue.set(value, hit);
        return hit.value;
      }
    }
  }

  relateArrays(value, other, pairwise) {
    if (value.length !== other.length) return false;

    for (let index = 0; index < value.length; index += 1) {
      if (!this.equate(value[index], other[index], pairwise)) {
        return false;
      }
    }

    return true;
  }

  equate(value, other, pairwise) {
    if (value === other) {
      return true;
    } else if (typeof value === "function" && typeof other === "function") {
      return value.toString() === other.toString();
    } else if (pairwise && Array.isArray(value) && Array.isArray(other)) {
      // special check for duple arrays in entries list
      return (
        value.length === 2 &&
        other.length === 2 &&
        value[0] === other[0] &&
        value[1] === other[1]
      );
    } else {
      return false;
    }
  }
}
