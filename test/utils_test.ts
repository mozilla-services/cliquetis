import {
  deepEqual,
  sortObjects,
  filterObjects,
  omitKeys,
  waterfall,
  transformSubObjectFilters,
  getDeepKey,
  partition,
  delay,
  qsify,
  checkVersion,
  support,
  capable,
  nobatch,
  parseDataURL,
  extractFileInfo,
  cleanUndefinedProperties,
  addEndpointOptions,
} from "../src/utils";
import { expectAsyncError } from "./test_utils";

describe("Utils", () => {
  /** @test {sortObjects} */
  describe("#sortObjects", () => {
    it("should order on field ASC", () => {
      expect(sortObjects("title", [{ title: "b" }, { title: "a" }])).eql([
        { title: "a" },
        { title: "b" },
      ]);
    });

    it("should order on field DESC", () => {
      expect(sortObjects("-title", [{ title: "a" }, { title: "b" }])).eql([
        { title: "b" },
        { title: "a" },
      ]);
    });

    it("should order on mixed undefined values DESC", () => {
      expect(
        sortObjects("-title", [
          { title: undefined },
          { title: "b" },
          { title: undefined },
        ])
      ).eql([{ title: "b" }, { title: undefined }, { title: undefined }]);
    });

    it("should order on mixed undefined values ASC", () => {
      expect(
        sortObjects("title", [
          { title: undefined },
          { title: "b" },
          { title: undefined },
        ])
      ).eql([{ title: undefined }, { title: undefined }, { title: "b" }]);
    });

    it("should not change order on all fields undefined", () => {
      expect(
        sortObjects("-title", [
          { title: undefined, x: 1 },
          { title: undefined, x: 2 },
        ])
      ).eql([
        { title: undefined, x: 1 },
        { title: undefined, x: 2 },
      ]);
    });

    it("should not order the list on missing field", () => {
      expect(sortObjects("-missing", [{ title: "a" }, { title: "b" }])).eql([
        { title: "a" },
        { title: "b" },
      ]);
    });
  });

  /** @test {filterObjects} */
  describe("#filterObjects", () => {
    it("should filter list on a single field query", () => {
      expect(
        filterObjects({ title: "a" }, [{ title: "b" }, { title: "a" }])
      ).eql([{ title: "a" }]);
    });

    it("should filter list on a multiple fields query", () => {
      expect(
        filterObjects({ title: "a", unread: true }, [
          { title: "b", unread: true },
          { title: "a", unread: false },
          { title: "a", unread: true },
        ])
      ).eql([{ title: "a", unread: true }]);
    });

    it("should filter list on missing field", () => {
      expect(filterObjects({ missing: true }, [{ existing: true }])).eql([]);
    });

    it("should filter on multiple field values", () => {
      expect(
        filterObjects({ title: ["a", "c"] }, [
          { title: "a" },
          { title: "b" },
          { title: "c" },
          { title: "d" },
        ])
      ).eql([{ title: "a" }, { title: "c" }]);
    });
  });

  /** @test {waterfall} */
  describe("#waterfall", () => {
    it("should resolve with init value when list is empty", async () => {
      const result = await waterfall([], 42);
      expect(result).toBe(42);
    });

    it("should resolve executing a single sync function", async () => {
      const result = await waterfall([(x) => x + 1], 42);
      expect(result).toBe(43);
    });

    it("should resolve executing multiple sync functions", async () => {
      const result = await waterfall([(x) => x + 1, (x) => x * 2], 42);
      expect(result).toBe(86);
    });

    it("should resolve using a single promise returning function", async () => {
      const result = await waterfall([() => Promise.resolve(42)]);
      expect(result).toBe(42);
    });

    it("should resolve using multiple promise returning functions", async () => {
      const result = await waterfall(
        [(x) => Promise.resolve(x + 1), (x) => Promise.resolve(x * 2)],
        42
      );
      expect(result).toBe(86);
    });
  });

  describe("deepEqual", () => {
    it("should return true if values are equal", () => {
      expect(deepEqual(null, null)).eql(true);
      expect(deepEqual(undefined, undefined)).eql(true);
      expect(deepEqual(1, 1)).eql(true);
      expect(deepEqual(1, 1.0)).eql(true);
      expect(deepEqual("a", "a")).eql(true);
      expect(deepEqual({}, {})).eql(true);
      expect(deepEqual([], [])).eql(true);
    });

    it("should return true if key are not sorted", () => {
      expect(deepEqual({ a: "1", b: 2 }, { b: 2, a: "1" })).eql(true);
    });

    it("should return true if array values are equal", () => {
      expect(deepEqual({ a: [1, 2, 3] }, { a: [1, 2, 3] })).eql(true);
    });

    it("should return true if sub-objects are equal", () => {
      expect(deepEqual({ a: { b: 1, c: 2 } }, { a: { b: 1, c: 2 } })).eql(true);
    });

    it("should return false if one is falsy", () => {
      expect(deepEqual({ id: "1" }, null)).eql(false);
      expect(deepEqual({ id: "1" }, undefined)).eql(false);
      expect(deepEqual(null, undefined)).eql(false);
    });

    it("should return false with extra keys", () => {
      expect(deepEqual({ a: 1 }, { a: 1, b: "a" })).eql(false);
    });

    it("should return false with different types", () => {
      expect(deepEqual({ a: 1 }, { a: "1" })).eql(false);
    });

    it("should return true when object keys order differs", () => {
      expect(deepEqual({ a: { b: 1, c: 2 } }, { a: { c: 2, b: 1 } })).eql(true);
    });

    it("should return false if sub-object differs", () => {
      expect(deepEqual({ a: { b: 1, c: 2 } }, { a: { b: 1, c: 3 } })).eql(
        false
      );
    });

    it("should return true if sub-arrays of objects are equal", () => {
      expect(
        deepEqual({ a: [{ b: 1 }, { c: 1 }] }, { a: [{ b: 1 }, { c: 1 }] })
      ).eql(true);
    });

    it("should return false if sub-array orders differ", () => {
      expect(
        deepEqual({ a: [{ b: 1 }, { c: 1 }] }, { a: [{ c: 1 }, { b: 1 }] })
      ).eql(false);
    });
  });

  describe("omitKeys", () => {
    it("should return same object if no key is passed", () => {
      const input = { a: 1, b: 2 };
      expect(omitKeys(input)).eql(input);
    });

    it("should omit specified keys", () => {
      expect(omitKeys({ a: 1, b: 2 }, ["b", "c"])).eql({ a: 1 });
    });
  });

  describe("transformSubObjectFilters", () => {
    it("should convert string in dot notation to nested object", () => {
      const input = { "a.b.c.d": 0 };
      expect(transformSubObjectFilters(input)).eql({
        a: { b: { c: { d: 0 } } },
      });
    });

    it("multiple strings with repeated keys become one object with unique keys", () => {
      const input = {
        "a.b.c.d": 0,
        "a.b.c.arr": [1, 2, 3],
        "a.b.k.hello": "world",
      };
      expect(transformSubObjectFilters(input)).eql({
        a: {
          b: {
            c: {
              d: 0,
              arr: [1, 2, 3],
            },
            k: {
              hello: "world",
            },
          },
        },
      });
    });
  });

  describe("getDeepKey", () => {
    const record = {
      title: "The Lusty Argonian Maid",
      author: {
        name: "Crassius Curio",
      },
    };

    it("should deeply access dot-notation properties", () => {
      expect(getDeepKey(record, "author.name")).to.equal("Crassius Curio");
    });

    it("should access properties", () => {
      expect(getDeepKey(record, "title")).to.equal("The Lusty Argonian Maid");
    });

    it("should return undefined for undefined properties", () => {
      expect(getDeepKey(record, "year")).to.equal(undefined);
      expect(getDeepKey(record, "publisher.name")).to.equal(undefined);
    });
  });
});

describe("HTTP Utils", () => {
  /** @test {partition} */
  describe("#partition", () => {
    it("should chunk array", () => {
      expect(partition([1, 2, 3], 2)).eql([[1, 2], [3]]);
      expect(partition([1, 2, 3], 1)).eql([[1], [2], [3]]);
      expect(partition([1, 2, 3, 4, 5], 3)).eql([
        [1, 2, 3],
        [4, 5],
      ]);
      expect(partition([1, 2], 2)).eql([[1, 2]]);
    });

    it("should still chunk array with n<=0", () => {
      expect(partition([1, 2, 3], 0)).eql([[1, 2, 3]]);
      expect(partition([1, 2, 3], -1)).eql([[1, 2, 3]]);
    });
  });

  /** @test {delay} */
  describe("#delay", () => {
    it("should delay resolution after the specified amount of time", () => {
      const start = new Date().getTime();
      return delay(10).then(() => {
        expect(new Date().getTime() - start).to.be.at.least(9);
      });
    });
  });

  /** @test {qsify} */
  describe("#qsify", () => {
    it("should generate a query string from an object", () => {
      expect(qsify({ a: 1, b: 2 })).eql("a=1&b=2");
    });

    it("should strip out undefined values", () => {
      expect(qsify({ a: undefined, b: 2 })).eql("b=2");
    });

    it("should join comma-separated values", () => {
      expect(qsify({ a: [1, 2], b: 2 })).eql("a=1,2&b=2");
    });

    it("should map boolean as lowercase string", () => {
      expect(qsify({ a: [true, 2], b: false })).eql("a=true,2&b=false");
    });

    it("should escaped values", () => {
      expect(qsify({ a: ["é", "ə"], b: "&" })).eql("a=%C3%A9,%C9%99&b=%26");
    });
  });

  /** @test {addEndpointOptions} */
  describe("#addEndpointOptions", () => {
    it("should add query options", () => {
      expect(addEndpointOptions("/a", { query: { a: '"123"' } })).eql(
        "/a?a=%22123%22"
      );
    });

    it("should understand _fields", () => {
      expect(addEndpointOptions("/a", { fields: ["a", "b"] })).eql(
        "/a?_fields=a,b"
      );
    });

    it("should not add ? if no options", () => {
      expect(addEndpointOptions("/a")).eql("/a");
    });
  });

  describe("#checkVersion", () => {
    it("should accept a version within provided range", () => {
      checkVersion("1.0", "1.0", "2.0");
      checkVersion("1.10", "1.0", "2.0");
      checkVersion("1.10", "1.9", "2.0");
      checkVersion("2.1", "1.0", "2.2");
      checkVersion("2.1", "1.2", "2.2");
      checkVersion("1.4", "1.4", "2.0");
    });

    it("should not accept a version oustide provided range", () => {
      expect(() => checkVersion("0.9", "1.0", "2.0")).to.Throw(Error);
      expect(() => checkVersion("2.0", "1.0", "2.0")).to.Throw(Error);
      expect(() => checkVersion("2.1", "1.0", "2.0")).to.Throw(Error);
      expect(() => checkVersion("3.9", "1.0", "2.10")).to.Throw(Error);
      expect(() => checkVersion("1.3", "1.4", "2.0")).to.Throw(Error);
    });
  });

  describe("@support", () => {
    it("should return a function", () => {
      expect(support("", "")).to.be.a("function");
    });

    it("should make decorated method resolve on version match", () => {
      class FakeClient {
        fetchHTTPApiVersion() {
          return Promise.resolve("1.4"); // simulates a successful checkVersion call
        }

        @support("1.0", "2.0")
        test() {
          return Promise.resolve();
        }
      }

      return new FakeClient().test();
    });

    it("should make decorated method rejecting on version mismatch", () => {
      class FakeClient {
        fetchHTTPApiVersion() {
          return Promise.resolve("1.4"); // simulates a failing checkVersion call
        }

        @support("1.5", "2.0")
        test() {
          return Promise.resolve();
        }
      }

      return new FakeClient().test().then(
        () => {
          throw new Error("Should be rejected");
        },
        (err) => {
          expect(err).toBeDefined();
        }
      );
    });

    it("should check for an attached client instance", () => {
      class FakeClient {
        // @ts-ignore
        private client: { fetchHTTPApiVersion: () => Promise<void> };
        constructor() {
          this.client = {
            fetchHTTPApiVersion() {
              return Promise.reject(); // simulates a failing checkVersion call
            },
          };
        }

        @support("", "")
        test() {
          return Promise.resolve();
        }
      }

      return new FakeClient().test().then(
        () => {
          throw new Error("Should be rejected");
        },
        (err) => {
          expect(err).to.be.undefined;
        }
      );
    });
  });

  describe("@capable", () => {
    it("should return a function", () => {
      expect(capable([])).to.be.a("function");
    });

    it("should make decorated method checking the capabilities", () => {
      class FakeClient {
        fetchServerCapabilities() {
          return Promise.resolve({}); // simulates a successful checkVersion call
        }

        @capable([])
        test() {
          return Promise.resolve();
        }
      }

      return new FakeClient().test();
    });

    it("should make decorated method resolve on capability match", () => {
      class FakeClient {
        fetchServerCapabilities() {
          return Promise.resolve({
            attachments: {},
            default: {},
            "auth:fxa": {},
          });
        }

        @capable(["default", "attachments"])
        test() {
          return Promise.resolve();
        }
      }

      return new FakeClient().test();
    });

    it("should make decorated method rejecting on missing capability", async () => {
      class FakeClient {
        fetchServerCapabilities() {
          return Promise.resolve({ attachments: {} });
        }

        @capable(["attachments", "default"])
        test() {
          return Promise.resolve();
        }
      }

      await expectAsyncError(
        () => new FakeClient().test(),
        /default not present/
      );
    });
  });

  describe("@nobatch", () => {
    it("should return a function", () => {
      expect(nobatch("")).to.be.a("function");
    });

    it("should make decorated method pass when not in batch", () => {
      class FakeClient {
        // @ts-ignore
        private _isBatch: boolean;
        constructor() {
          this._isBatch = false;
        }

        @nobatch("error")
        test() {
          return Promise.resolve();
        }
      }

      return new FakeClient().test();
    });

    it("should make decorated method to throw if in batch", () => {
      class FakeClient {
        // @ts-ignore
        private _isBatch: boolean;
        constructor() {
          this._isBatch = true;
        }

        @nobatch("error")
        test() {
          return Promise.resolve();
        }
      }

      expect(() => new FakeClient().test()).to.Throw(Error, "error");
    });
  });

  describe("parseDataURL()", () => {
    it("should extract expected properties", () => {
      expect(
        parseDataURL("data:image/png;encoding=utf-8;name=a.png;base64,b64")
      ).eql({
        type: "image/png",
        name: "a.png",
        base64: "b64",
        encoding: "utf-8",
      });
    });

    it("should support dataURL without name", () => {
      expect(parseDataURL("data:image/png;base64,b64")).eql({
        type: "image/png",
        base64: "b64",
      });
    });

    it("should throw an error when the data url is invalid", () => {
      expect(() => expect(parseDataURL("gni"))).to.throw(
        Error,
        "Invalid data-url: gni..."
      );
    });
  });

  describe("extractFileInfo()", () => {
    it("should extract file information from a data url", () => {
      const dataURL = "data:text/plain;name=t.txt;base64," + btoa("test");

      const { blob, name } = extractFileInfo(dataURL);

      if ("size" in blob) {
        expect(blob.size).eql(4);
      } else {
        // In Node, `blob` is actually a Buffer
        expect((blob as any).length).eql(4);
      }
      expect(name).eql("t.txt");
    });
  });

  describe("cleanUndefinedProperties()", () => {
    it("should remove undefined properties from an object", () => {
      const obj1 = cleanUndefinedProperties({ a: 1, b: undefined });
      /* eslint-disable no-prototype-builtins */
      expect(obj1.hasOwnProperty("a")).eql(true);
      expect(obj1.hasOwnProperty("b")).eql(false);
      /* eslint-enable no-prototype-builtins */
    });
  });
});
