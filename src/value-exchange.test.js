const { ValueExchange, callback, memo } = require("../dist/value-exchange");

test("should cache callbacks", () => {
  const exchange = new ValueExchange();

  function* task(scoped) {
    return yield* callback(yield scoped, () => scoped);
  }

  expect([]).not.toBe([]);
  expect(exchange.handle(task([]))).toBe(exchange.handle(task([])));

  expect([{}]).not.toBe([{}]);
  expect(() => "function").not.toBe(() => "function");
  expect(exchange.handle(task([{}]))).not.toBe(exchange.handle(task([{}])));

  expect(exchange.handle(task({ a: 1, b: true }))).toBe(
    exchange.handle(task({ b: true, a: 1 }))
  );

  expect(exchange.handle(task(new Map().set("a", 1).set("b", true)))).toBe(
    exchange.handle(task(new Map().set("a", 1).set("b", true)))
  );

  expect(exchange.handle(task(new Map().set("a", 1).set("b", true)))).not.toBe(
    exchange.handle(task(new Map().set("b", true).set("a", 1)))
  );
});

test("should cache memos", () => {
  const exchange = new ValueExchange();

  function* task(scoped) {
    return yield* memo(scoped, value => new Map().set("scoped", value));
  }

  expect(exchange.handle(task(exchange))).toBeInstanceOf(Map);
  expect(exchange.handle(task(exchange))).toBe(exchange.handle(task(exchange)));
  expect(exchange.handle(task(exchange)).get("scoped")).toBe(exchange);
});

test("should flush eventually", () => {
  const exchange = new ValueExchange();

  function* task(scoped) {
    return yield* memo(scoped, value => new Map().set("scoped", value));
  }

  const result = exchange.handle(task(exchange));

  expect(exchange.handle(task(exchange))).toBe(result);

  exchange.sweep();

  expect(exchange.handle(task(exchange))).toBe(result);

  exchange.sweep();

  expect(exchange.handle(task(exchange))).toBe(result);

  exchange.sweep();
  exchange.sweep();

  expect(exchange.handle(task(exchange))).not.toBe(result);
});
