/* eslint dot-notation: off */
import KintoClient from "../../src/http";
import Bucket from "../../src/http/bucket";
import Collection, { CollectionOptions } from "../../src/http/collection";
import {
  fakeServerResponse,
  expectAsyncError,
  fakeHeaders,
} from "../test_utils";
import { PaginationResult } from "../../src/http/base";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  Mock,
  vitest,
} from "vitest";

const FAKE_SERVER_URL = "http://fake-server/v1";

/** @test {Collection} */
describe("HTTP Collection", () => {
  let client: KintoClient, coll: Collection;

  beforeEach(() => {
    client = new KintoClient(FAKE_SERVER_URL);
    const bucket = new Bucket(client, "blog", { headers: { Foo: "Bar" } });
    coll = new Collection(client, bucket, "posts", { headers: { Baz: "Qux" } });
  });

  afterEach(() => {
    vitest.restoreAllMocks();
  });

  function getBlogPostsCollection(options?: CollectionOptions) {
    return new Bucket(client, "blog").collection("posts", options);
  }

  /** @test {Collection#getTotalRecords} */
  describe("#getTotalRecords()", () => {
    it("should execute expected request", async () => {
      const executeStub = vitest
        .spyOn(client, "execute")
        .mockResolvedValue({ headers: fakeHeaders() });

      await getBlogPostsCollection().getTotalRecords();

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "HEAD",
          path: "/buckets/blog/collections/posts/records",
          headers: {},
        },
        //@ts-ignore Limitation of the Parameters type for overloaded functions
        { raw: true, retry: 0 }
      );
    });

    it("should resolve with the Total-Records header value", async () => {
      vitest.spyOn(client, "execute").mockResolvedValue({
        headers: {
          get() {
            return 42;
          },
        },
      });

      expect(await getBlogPostsCollection().getTotalRecords()).toBe(42);
    });
  });

  /** @test {Collection#getData} */
  describe("#getData()", () => {
    it("should execute expected request", async () => {
      const executeStub = vitest
        .spyOn(client, "execute")
        .mockResolvedValue({ headers: fakeHeaders() });

      await getBlogPostsCollection().getData();

      expect(executeStub).toHaveBeenCalledWith(
        {
          path: "/buckets/blog/collections/posts",
          headers: {},
        },
        {
          fields: undefined,
          query: undefined,
          retry: 0,
        }
      );
    });

    it("should resolve with response data", async () => {
      const response = { data: { foo: "bar" } };
      vitest.spyOn(client, "execute").mockResolvedValue(response);

      const data = (await getBlogPostsCollection().getData()) as {
        foo: string;
      };
      expect(data).toStrictEqual({
        foo: "bar",
      });
    });

    it("should pass query through", async () => {
      const requestStub = vitest
        .spyOn(client.http, "request")
        .mockResolvedValue({
          headers: fakeHeaders(),
          json: {},
          status: 200,
        });

      await getBlogPostsCollection().getData({ query: { _expected: '"123"' } });

      expect(requestStub).toHaveBeenCalledWith(
        "http://fake-server/v1/buckets/blog/collections/posts?_expected=%22123%22",
        {
          headers: {},
        },
        { retry: 0 }
      );
    });

    it("supports _fields", async () => {
      const requestStub = vitest
        .spyOn(client.http, "request")
        .mockResolvedValue({
          headers: fakeHeaders(),
          json: {},
          status: 200,
        });

      await getBlogPostsCollection().getData({ fields: ["a", "b"] });

      expect(requestStub).toHaveBeenCalledWith(
        "http://fake-server/v1/buckets/blog/collections/posts?_fields=a,b",
        {
          headers: {},
        },
        { retry: 0 }
      );
    });
  });

  /** @test {Collection#getPermissions} */
  describe("#getPermissions()", () => {
    beforeEach(() => {
      vitest.spyOn(client, "execute").mockResolvedValue({
        data: {},
        permissions: { write: ["fakeperms"] },
      });
    });

    it("should retrieve permissions", async () => {
      expect(await coll.getPermissions()).toStrictEqual({
        write: ["fakeperms"],
      });
    });
  });

  /** @test {Collection#setPermissions} */
  describe("#setPermissions()", () => {
    const fakePermissions = { read: [] as string[], write: [] as string[] };
    let executeStub: Mock;

    beforeEach(() => {
      executeStub = vitest.spyOn(client, "execute").mockResolvedValue({});
    });

    it("should set permissions", () => {
      coll.setPermissions(fakePermissions);

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "PUT",
          path: "/buckets/blog/collections/posts",
          headers: { Foo: "Bar", Baz: "Qux" },
          body: {
            data: undefined,
            permissions: fakePermissions,
          },
        },
        { retry: 0 }
      );
    });

    it("should handle the safe option", () => {
      coll.setPermissions(fakePermissions, { safe: true, last_modified: 42 });

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "PUT",
          path: "/buckets/blog/collections/posts",
          headers: { Foo: "Bar", Baz: "Qux", "If-Match": '"42"' },
          body: {
            data: undefined,
            permissions: fakePermissions,
          },
        },
        { retry: 0 }
      );
    });

    it("should resolve with json result", async () => {
      expect(await coll.setPermissions(fakePermissions)).toStrictEqual({});
    });
  });

  /** @test {Collection#addPermissions} */
  describe("#addPermissions()", () => {
    const fakePermissions = { read: [] as string[], write: [] as string[] };
    let executeStub: Mock;

    beforeEach(() => {
      executeStub = vitest.spyOn(client, "execute").mockResolvedValue({});
    });

    it("should append permissions", () => {
      coll.addPermissions(fakePermissions);

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "PATCH",
          path: "/buckets/blog/collections/posts",
          headers: {
            Foo: "Bar",
            Baz: "Qux",
            "Content-Type": "application/json-patch+json",
          },
          body: [],
        },
        { retry: 0 }
      );
    });

    it("should handle the safe option", () => {
      coll.addPermissions(fakePermissions, { safe: true, last_modified: 42 });

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "PATCH",
          path: "/buckets/blog/collections/posts",
          headers: {
            Foo: "Bar",
            Baz: "Qux",
            "Content-Type": "application/json-patch+json",
            "If-Match": `"42"`,
          },
          body: [],
        },
        { retry: 0 }
      );
    });

    it("should resolve with json result", async () => {
      expect(await coll.setPermissions(fakePermissions)).toStrictEqual({});
    });
  });

  /** @test {Collection#removePermissions} */
  describe("#removePermissions()", () => {
    const fakePermissions = { read: [] as string[], write: [] as string[] };
    let executeStub: Mock;

    beforeEach(() => {
      executeStub = vitest.spyOn(client, "execute").mockResolvedValue({});
    });

    it("should pop permissions", () => {
      coll.setPermissions(fakePermissions);

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "PUT",
          path: "/buckets/blog/collections/posts",
          headers: {
            Foo: "Bar",
            Baz: "Qux",
          },
          body: { data: undefined, permissions: fakePermissions },
        },
        { retry: 0 }
      );
    });

    it("should handle the safe option", () => {
      coll.setPermissions(fakePermissions, { safe: true, last_modified: 42 });

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "PUT",
          path: "/buckets/blog/collections/posts",
          headers: {
            Foo: "Bar",
            Baz: "Qux",
            "If-Match": `"42"`,
          },
          body: { data: undefined, permissions: fakePermissions },
        },
        { retry: 0 }
      );
    });

    it("should resolve with json result", async () => {
      expect(await coll.setPermissions(fakePermissions)).toStrictEqual({});
    });
  });

  /** @test {Collection#setData} */
  describe("#setData()", () => {
    let executeStub: Mock;

    beforeEach(() => {
      executeStub = vitest
        .spyOn(client, "execute")
        .mockResolvedValue({ data: { foo: "bar" } });
    });

    it("should set the data", () => {
      coll.setData({ a: 1 });

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "PUT",
          path: "/buckets/blog/collections/posts",
          headers: {
            Foo: "Bar",
            Baz: "Qux",
          },
          body: { data: { a: 1 } },
        },
        { retry: 0 }
      );
    });

    it("should handle the safe option", () => {
      coll.setData({ a: 1 }, { safe: true, last_modified: 42 });

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "PUT",
          path: "/buckets/blog/collections/posts",
          headers: {
            Foo: "Bar",
            Baz: "Qux",
            "If-Match": `"42"`,
          },
          body: { data: { a: 1 } },
        },
        { retry: 0 }
      );
    });

    it("should handle the patch option", () => {
      coll.setData({ a: 1 }, { patch: true });

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "PATCH",
          path: "/buckets/blog/collections/posts",
          headers: {
            Foo: "Bar",
            Baz: "Qux",
          },
          body: { data: { a: 1 } },
        },
        { retry: 0 }
      );
    });

    it("should resolve with json result", async () => {
      expect(await coll.setData({ a: 1 })).toStrictEqual({
        data: { foo: "bar" },
      });
    });
  });

  /** @test {Collection#createRecord} */
  describe("#createRecord()", () => {
    const record = { title: "foo" };
    let executeStub: Mock;

    beforeEach(() => {
      executeStub = vitest
        .spyOn(client, "execute")
        .mockResolvedValue({ data: 1 });
    });

    it("should create the expected request", () => {
      coll.createRecord(record);

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "POST",
          path: "/buckets/blog/collections/posts/records",
          headers: {
            Foo: "Bar",
            Baz: "Qux",
          },
          body: { data: record },
        },
        { retry: 0 }
      );
    });

    it("should accept a safe option", () => {
      coll.createRecord(record, { safe: true });

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "POST",
          path: "/buckets/blog/collections/posts/records",
          headers: {
            Foo: "Bar",
            Baz: "Qux",
            "If-None-Match": "*",
          },
          body: { data: record },
        },
        { retry: 0 }
      );
    });

    it("should execute the expected request", () => {
      return coll.createRecord(record).then(() => {
        expect(executeStub.mock.calls[0][0]).toHaveProperty(
          "path",
          "/buckets/blog/collections/posts/records"
        );
      });
    });

    it("should resolve with response body", async () => {
      expect(await coll.createRecord(record)).toStrictEqual({ data: 1 });
    });
  });

  /** @test {Collection#updateRecord} */
  describe("#updateRecord()", () => {
    const record = { id: "2", title: "foo" };
    let executeStub: Mock;

    beforeEach(() => {
      executeStub = vitest
        .spyOn(client, "execute")
        .mockResolvedValue({ data: 1 });
    });

    it("should throw if record is not an object", async () => {
      await expectAsyncError(
        () => coll.updateRecord(2 as any),
        /record object is required/
      );
    });

    it("should throw if id is missing", async () => {
      await expectAsyncError(
        () => coll.updateRecord({} as any),
        /record id is required/
      );
    });

    it("should create the expected request", () => {
      coll.updateRecord(record);

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "PUT",
          path: "/buckets/blog/collections/posts/records/2",
          headers: {
            Foo: "Bar",
            Baz: "Qux",
          },
          body: { data: record },
        },
        { retry: 0 }
      );
    });

    it("should accept a safe option", () => {
      coll.updateRecord({ ...record, last_modified: 42 }, { safe: true });

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "PUT",
          path: "/buckets/blog/collections/posts/records/2",
          headers: {
            Foo: "Bar",
            Baz: "Qux",
            "If-Match": `"42"`,
          },
          body: {
            data: {
              ...record,
              last_modified: 42,
            },
            permissions: undefined,
          },
        },
        { retry: 0 }
      );
    });

    it("should accept a patch option", () => {
      coll.updateRecord(record, { patch: true });

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "PATCH",
          path: "/buckets/blog/collections/posts/records/2",
          headers: {
            Foo: "Bar",
            Baz: "Qux",
          },
          body: { data: record, permissions: undefined },
        },
        { retry: 0 }
      );
    });

    it("should resolve with response body", async () => {
      expect(await coll.updateRecord(record)).toStrictEqual({ data: 1 });
    });
  });

  /** @test {Collection#deleteRecord} */
  describe("#deleteRecord()", () => {
    // let deleteRequestStub: Stub<typeof requests.deleteRequest>;
    let executeStub: Mock;

    beforeEach(() => {
      // deleteRequestStub = vitest.spyOn(requests, "deleteRequest");
      executeStub = vitest
        .spyOn(client, "execute")
        .mockResolvedValue({ data: 1 });
    });

    it("should throw if id is missing", async () => {
      await expectAsyncError(
        () => coll.deleteRecord({} as any),
        /record id is required/
      );
    });

    it("should delete a record", () => {
      coll.deleteRecord("1");

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "DELETE",
          path: "/buckets/blog/collections/posts/records/1",
          headers: {
            Foo: "Bar",
            Baz: "Qux",
          },
        },
        { retry: 0 }
      );
    });

    it("should throw if safe is true and last_modified isn't provided", async () => {
      await expectAsyncError(
        () => coll.deleteRecord("1", { safe: true }),
        /Safe concurrency check requires a last_modified value./
      );
    });

    it("should rely on the provided last_modified for the safe option", () => {
      coll.deleteRecord({ id: "1", last_modified: 42 }, { safe: true });

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "DELETE",
          path: "/buckets/blog/collections/posts/records/1",
          headers: {
            Foo: "Bar",
            Baz: "Qux",
            "If-Match": `"42"`,
          },
        },
        { retry: 0 }
      );
    });
  });

  /** @test {Collection#deleteRecords} */
  describe("#deleteRecords()", () => {
    let executeStub: Mock;

    beforeEach(() => {
      executeStub = vitest
        .spyOn(client, "execute")
        .mockResolvedValue({ data: {} });
    });

    it("should delete all records", () => {
      coll.deleteRecords();

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "DELETE",
          path: "/buckets/blog/collections/posts/records?_sort=-last_modified",
          headers: {
            Baz: "Qux",
            Foo: "Bar",
          },
        },
        { raw: true, retry: 0 }
      );
    });

    it("should accept a timestamp option", () => {
      coll.deleteRecords({
        filters: { since: 42 },
      });

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "DELETE",
          path: "/buckets/blog/collections/posts/records?since=42&_sort=-last_modified",
          headers: {
            Baz: "Qux",
            Foo: "Bar",
          },
        },
        { raw: true, retry: 0 }
      );
    });

    it("should extend request headers with optional ones", () => {
      coll["_headers"] = { Foo: "Bar" };
      coll.deleteRecords({ headers: { Baz: "Qux" } });

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "DELETE",
          path: "/buckets/blog/collections/posts/records?_sort=-last_modified",
          headers: { Foo: "Bar", Baz: "Qux" },
        },
        { raw: true, retry: 0 }
      );
    });

    it("should support filters and fields", () => {
      coll.deleteRecords({
        filters: { a: "b" },
        fields: ["c", "d"],
      });

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "DELETE",
          path: "/buckets/blog/collections/posts/records?a=b&_sort=-last_modified&_fields=c,d",
          headers: {
            Baz: "Qux",
            Foo: "Bar",
          },
        },
        {
          raw: true,
          retry: 0,
        }
      );
    });
  });

  /** @test {Collection#getRecord} */
  describe("#getRecord()", () => {
    let executeStub: Mock;

    beforeEach(() => {
      executeStub = vitest
        .spyOn(client, "execute")
        .mockResolvedValue({ data: 1 });
    });

    it("should execute expected request", () => {
      coll.getRecord("1");

      expect(executeStub).toHaveBeenCalledWith(
        {
          path: "/buckets/blog/collections/posts/records/1",
          headers: { Foo: "Bar", Baz: "Qux" },
        },
        {
          fields: undefined,
          query: undefined,
          retry: 0,
        }
      );
    });

    it("should retrieve a record", async () => {
      expect(await coll.getRecord("1")).toStrictEqual({ data: 1 });
    });

    it("should support query and fields", () => {
      coll.getRecord("1", { query: { a: "b" }, fields: ["c", "d"] });

      expect(executeStub).toHaveBeenCalledWith(
        {
          headers: { Baz: "Qux", Foo: "Bar" },
          path: "/buckets/blog/collections/posts/records/1",
        },
        { fields: ["c", "d"], query: { a: "b" }, retry: 0 }
      );
    });
  });

  /** @test {Collection#getRecordsTimestamp} */
  describe("#getRecordsTimestamp()", () => {
    it("should execute expected request", async () => {
      const executeStub = vitest
        .spyOn(client, "execute")
        .mockResolvedValue({ headers: fakeHeaders() });

      await getBlogPostsCollection().getRecordsTimestamp();

      expect(executeStub).toHaveBeenCalledWith(
        {
          method: "HEAD",
          path: "/buckets/blog/collections/posts/records",
          headers: {},
        },
        //@ts-ignore Limitation of the Parameters type for overloaded functions
        { raw: true, retry: 0 }
      );
    });

    it("should resolve with the ETag header value", async () => {
      const etag = '"42"';
      vitest.spyOn(client, "execute").mockResolvedValue({
        headers: {
          get(value: string) {
            return value == "ETag" ? etag : null;
          },
        },
      });

      expect(
        await getBlogPostsCollection().getRecordsTimestamp()
      ).toStrictEqual(etag);
    });
  });

  /** @test {Collection#listRecords} */
  describe("#listRecords()", () => {
    const data: PaginationResult<{ id: string }> = {
      last_modified: "",
      data: [{ id: "a" }, { id: "b" }],
      next: () => {
        return Promise.resolve(
          {} as unknown as PaginationResult<{
            id: string;
          }>
        );
      },
      hasNextPage: false,
      totalRecords: 2,
    };
    let paginatedListStub: Mock;

    beforeEach(() => {
      paginatedListStub = vitest
        .spyOn(coll.client, "paginatedList")
        .mockResolvedValue(data);
    });

    it("should execute expected request", () => {
      coll.listRecords({ since: "42" });

      expect(paginatedListStub).toHaveBeenCalledWith(
        "/buckets/blog/collections/posts/records",
        { since: "42" },
        { headers: { Baz: "Qux", Foo: "Bar" }, retry: 0 }
      );
    });

    it("should support passing custom headers", () => {
      coll.listRecords({ headers: { "Another-Header": "Hello" } });

      expect(paginatedListStub).toHaveBeenCalledWith(
        expect.stringContaining("/buckets"),
        {
          headers: {
            "Another-Header": "Hello",
          },
        },
        {
          headers: { Foo: "Bar", Baz: "Qux", "Another-Header": "Hello" },
          retry: 0,
        }
      );
    });

    it("should resolve with a result object", async () => {
      expect(await coll.listRecords()).toHaveProperty("data", data.data);
    });

    it("should support filters and fields", () => {
      coll.listRecords({ filters: { a: "b" }, fields: ["c", "d"] });

      expect(paginatedListStub).toHaveBeenCalledWith(
        "/buckets/blog/collections/posts/records",
        { filters: { a: "b" }, fields: ["c", "d"] },
        {
          headers: {
            Baz: "Qux",
            Foo: "Bar",
          },
          retry: 0,
        }
      );
    });

    describe("Retry", () => {
      const response = { data: [{ id: 1, title: "art" }] };

      beforeEach(() => {
        vitest.restoreAllMocks();
        const fetchStub = vitest.spyOn(client.http as any, "fetchFunc");
        fetchStub.mockReturnValueOnce(
          fakeServerResponse(503, {}, { "Retry-After": "1" })
        );
        fetchStub.mockReturnValueOnce(fakeServerResponse(200, response));
      });

      it("should retry the request if option is specified", async () => {
        const { data } = await coll.listRecords({ retry: 1 });
        expect(data[0]).toHaveProperty("title", "art");
      });
    });
  });

  /** @test {Collection#batch} */
  describe("#batch()", () => {
    it("should batch operations", () => {
      const batchStub = vitest.fn();
      vitest.spyOn(client, "batch").mockImplementation(batchStub);
      // @ts-ignore
      const fn = (batch: any) => {};

      coll.batch(fn);

      expect(batchStub).toHaveBeenCalledWith(fn, {
        bucket: "blog",
        collection: "posts",
        headers: { Foo: "Bar", Baz: "Qux" },
        retry: 0,
        safe: false,
        aggregate: false,
      });
    });
  });

  /** @test {Collection#execute} */
  describe("#execute()", () => {
    it("should rely on client execute", () => {
      const executeStub = vitest.fn();
      vitest.spyOn(client, "execute").mockImplementation(executeStub);
      const req = { path: "/", headers: {} };

      coll.execute(req);

      expect(executeStub).toHaveBeenCalledWith(req);
    });
  });
});
