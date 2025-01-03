(global as any).FormData = require("form-data");
(global as any).atob = require("atob");
(global as any).btoa = require("btoa");

/**
 * In FakeIndexedDB, symbols are exposed using ``FDB`` prefixes in names.
 * This piece of code will register them with the same names as native API,
 * only if indexedDB is not already available.
 */
if (typeof globalThis.indexedDB !== "object") {
  const iDBSymbols = [
    "IDBDatabase",
    "IDBTransaction",
    "IDBObjectStore",
    "IDBIndex",
    "IDBCursor",
    "IDBCursorWithValue",
    "IDBKeyRange",
  ];

  iDBSymbols.forEach((symbol) => {
    const fakeSymbol = symbol.replace("IDB", "FDB");
    (globalThis as any)[symbol] = require(`fake-indexeddb/lib/${fakeSymbol}`);
  });

  globalThis.indexedDB = require("fake-indexeddb").default;
}
