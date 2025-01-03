import Api from "../../src/http";
import KintoClientBase, { KintoClientOptions } from "../../src/http/base";
import mitt from "mitt";
import KintoServer from "kinto-node-test-server";
import {
  delayedPromise,
  btoa,
  expectAsyncError,
  fakeBlob,
} from "../test_utils";
import Bucket from "../../src/http/bucket";
import Collection from "../../src/http/collection";
import {
  PermissionData,
  OperationResponse,
  KintoObject,
  Attachment,
  KintoResponse,
  Group,
} from "../../src/types";
import { AggregateResponse } from "../../src/http/batch";
import {
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vitest,
  Mock,
} from "vitest";
import { commands as vitestCommands } from "@vitest/browser/context";

vitestCommands.startServer();

interface TitleRecord extends KintoObject {
  title: string;
}

const skipLocalServer =
  typeof process !== "undefined" && !!process.env.TEST_KINTO_SERVER;
const TEST_KINTO_SERVER =
  (typeof process !== "undefined" && process.env.TEST_KINTO_SERVER) ||
  "http://0.0.0.0:8888/v1";
const KINTO_PROXY_SERVER =
  (typeof process !== "undefined" && process.env.KINTO_PROXY_SERVER) ||
  TEST_KINTO_SERVER;

async function startServer(
  server: KintoServer,
  options: { [key: string]: string } = {}
) {
  if (typeof window !== "undefined") {
    return vitestCommands.startServer();
  }

  if (!skipLocalServer) {
    await server.start(options);
  }
}

async function stopServer(server: KintoServer) {
  if (typeof window !== "undefined") {
    return vitestCommands.stopServer();
  }

  if (!skipLocalServer) {
    await server.stop();
  }
}

describe("HTTP Integration tests", () => {
  let server: KintoServer, api: Api;

  beforeAll(async () => {
    if (skipLocalServer) {
      return;
    }

    if (typeof window == "undefined") {
      let kintoConfigPath = __dirname + "/kinto.ini";
      if (process.env.SERVER && process.env.SERVER !== "master") {
        kintoConfigPath = `${__dirname}/kinto-${process.env.SERVER}.ini`;
      }
      server = new KintoServer(KINTO_PROXY_SERVER, {
        maxAttempts: 200,
        kintoConfigPath,
      });
      await server.loadConfig(kintoConfigPath);

      // need some polyfilling for integration tests to work properly
      const fetch = require("node-fetch");
      global.realFetch = global.fetch;
      global.realHeaders = global.Headers;
      (global as any).fetch = fetch;
      (global as any).Headers = fetch.Headers;
    }
  });

  afterAll(async () => {
    if (typeof window !== "undefined") {
      vitestCommands.startServer();
      return;
    }

    if (skipLocalServer) {
      return;
    }
    const logLines = server.logs.toString().split("\n");
    const serverDidCrash = logLines.some((l) => l.startsWith("Traceback"));
    if (serverDidCrash) {
      // Server errors have been encountered, raise to break the build
      const trace = logLines.join("\n");
      throw new Error(
        `Kinto server crashed while running the test suite.\n\n${trace}`
      );
    }
    server.killAll();

    if (typeof window == "undefined") {
      // resetting polyfill
      global.fetch = global.realFetch;
      global.Headers = global.realHeaders;
    }
  });

  function createClient(options: Partial<KintoClientOptions> = {}) {
    return new Api(TEST_KINTO_SERVER, options);
  }

  beforeEach(() => {
    if (typeof window == "undefined") {
      vitest.spyOn(global, "Blob").mockImplementation(fakeBlob);
    }

    const events = mitt();
    api = createClient({
      events,
      headers: { Authorization: "Basic " + btoa("user:pass") },
    });
  });

  afterEach(() => {
    vitest.restoreAllMocks();
  });

  describe("Default server configuration", () => {
    beforeAll(async () => {
      await startServer(server);
    });

    afterAll(async () => {
      await stopServer(server);
    });

    beforeEach(async () => {
      if (typeof window !== "undefined") {
        return vitestCommands.flushServer();
      }
      await server.flush();
    });

    // XXX move this to batch tests
    describe("new batch", () => {
      it("should support root batch", async function () {
        await api.batch((batch: KintoClientBase) => {
          const bucket = batch.bucket("default");
          bucket.createCollection("posts");
          const coll = bucket.collection("posts");
          coll.createRecord({ a: 1 });
          coll.createRecord({ a: 2 });
        });
        const res = await api
          .bucket("default")
          .collection("posts")
          .listRecords();
        expect(res.data).toHaveLength(2);
      });

      it("should support bucket batch", async function () {
        await api.bucket("default").batch((batch) => {
          batch.createCollection("posts");
          const coll = batch.collection("posts");
          coll.createRecord({ a: 1 });
          coll.createRecord({ a: 2 });
        });
        const res = await api
          .bucket("default")
          .collection("posts")
          .listRecords();
        expect(res.data).toHaveLength(2);
      });
    });

    describe("Server properties", () => {
      it("should retrieve server settings", async () => {
        expect(await api.fetchServerSettings()).toHaveProperty(
          "batch_max_requests",
          25
        );
      });

      it("should retrieve server capabilities", async () => {
        const capabilities = await api.fetchServerCapabilities();
        expectTypeOf(capabilities).toBeObject();
        // Kinto protocol 1.4 exposes capability descriptions
        Object.keys(capabilities).forEach((capability) => {
          const capabilityObj = capabilities[capability];
          expect(capabilityObj).toHaveProperty("url");
          expect(capabilityObj).toHaveProperty("description");
        });
      });

      it("should retrieve user information", async () => {
        const user = await api.fetchUser();
        expect(user!.id).toMatch(/^basicauth:/);
        expect(user!.bucket).toHaveLength(36);
      });

      it("should retrieve current API version", async () => {
        expect(await api.fetchHTTPApiVersion()).toMatch(/^\d\.\d+$/);
      });
    });

    describe("#createBucket", () => {
      let result: KintoResponse;

      describe("Default options", () => {
        describe("Autogenerated id", () => {
          beforeEach(async () => {
            result = await api.createBucket(null);
          });

          it("should create a bucket", () => {
            expectTypeOf(result.data.id).toBeString();
          });
        });

        describe("Custom id", () => {
          beforeEach(async () => {
            result = await api.createBucket("foo");
          });

          it("should create a bucket with the passed id", () => {
            expect(result).toHaveProperty("data.id", "foo");
          });

          it("should create a bucket having a list of write permissions", () => {
            expect(result).toHaveProperty("permissions.write");
            expectTypeOf(result.permissions.write).toBeArray();
          });

          describe("data option", () => {
            it("should create bucket data", async () => {
              expect(
                await api.createBucket("foo", { data: { a: 1 } })
              ).toHaveProperty("data.a", 1);
            });
          });

          describe("Safe option", () => {
            it("should not override existing bucket", async () => {
              await expectAsyncError(
                () => api.createBucket("foo", { safe: true }),
                /412 Precondition Failed/
              );
            });
          });
        });
      });

      describe("permissions option", () => {
        it("should create a bucket having a list of write permissions", async () => {
          const result = await api.createBucket("foo", {
            permissions: { read: ["github:n1k0"] },
          });

          expect(result).toHaveProperty("permissions.read", ["github:n1k0"]);
        });
      });
    });

    describe("#deleteBucket()", () => {
      let last_modified: number;

      beforeEach(async () => {
        const res = await api.createBucket("foo");
        last_modified = res.data.last_modified;
      });

      it("should delete a bucket", async () => {
        await api.deleteBucket("foo");
        const { data } = await api.listBuckets();
        expect(data.map((bucket) => bucket.id)).not.include("foo");
      });

      describe("Safe option", () => {
        it("should raise a conflict error when resource has changed", async () => {
          await expectAsyncError(
            () =>
              api.deleteBucket("foo", {
                last_modified: last_modified - 1000,
                safe: true,
              }),
            /412 Precondition Failed/
          );
        });
      });
    });

    describe("#deleteBuckets()", () => {
      beforeEach(async () => {
        await api.batch((batch: KintoClientBase) => {
          batch.createBucket("b1");
          batch.createBucket("b2");
        });
      });

      it("should delete all buckets", async () => {
        await api.deleteBuckets();
        await delayedPromise(50);
        const { data } = await api.listBuckets();
        expect(data).toStrictEqual([]);
      });
    });

    describe("#listPermissions", () => {
      describe("Single page of permissions", () => {
        beforeEach(async () => {
          await api.batch((batch: KintoClientBase) => {
            batch.createBucket("b1");
            batch.bucket("b1").createCollection("c1");
          });
        });

        it("should retrieve the list of permissions", async () => {
          let { data } = await api.listPermissions();
          // One element is for the root element which has
          // `bucket:create` as well as `account:create`. Remove
          // it.
          const isBucketCreate = (p_1: PermissionData) =>
            p_1.permissions.includes("bucket:create");
          const bucketCreate = data.filter(isBucketCreate);
          expect(bucketCreate.length).eql(1);
          data = data.filter((p_2) => !isBucketCreate(p_2));
          expect(data).to.have.lengthOf(2);
          expect(data.map((p_3) => p_3.id).sort()).eql(["b1", "c1"]);
        });
      });

      describe("Paginated list of permissions", () => {
        beforeEach(async () => {
          await api.batch((batch: KintoClientBase) => {
            for (let i = 1; i <= 15; i++) {
              batch.createBucket("b" + i);
            }
          });
        });

        it("should retrieve the list of permissions", async () => {
          const results = await api.listPermissions({ pages: Infinity });
          let expectedRecords = 15;
          expectedRecords++;
          expect(results.data).to.have.lengthOf(expectedRecords);
        });
      });
    });

    describe("#listBuckets", () => {
      beforeEach(async () => {
        await api.batch((batch: KintoClientBase) => {
          batch.createBucket("b1", { data: { size: 24 } });
          batch.createBucket("b2", { data: { size: 13 } });
          batch.createBucket("b3", { data: { size: 38 } });
          batch.createBucket("b4", { data: { size: -4 } });
        });
      });

      it("should retrieve the list of buckets", async () => {
        const { data } = await api.listBuckets();
        expect(data.map((bucket) => bucket.id).sort()).toStrictEqual([
          "b1",
          "b2",
          "b3",
          "b4",
        ]);
      });

      it("should order buckets by field", async () => {
        const { data } = await api.listBuckets({ sort: "-size" });
        expect(data.map((bucket) => bucket.id)).toStrictEqual([
          "b3",
          "b1",
          "b2",
          "b4",
        ]);
      });

      describe("Filtering", () => {
        it("should filter buckets", async () => {
          const { data } = await api.listBuckets({
            sort: "size",
            filters: { min_size: 20 },
          });
          expect(data.map((bucket) => bucket.id)).toStrictEqual(["b1", "b3"]);
        });

        it("should resolve with buckets last_modified value", async () => {
          expectTypeOf((await api.listBuckets()).last_modified).toBeString();
        });

        it("should retrieve only buckets after provided timestamp", async () => {
          const timestamp = (await api.listBuckets()).last_modified!;
          await api.createBucket("b5");
          expect(
            (await api.listBuckets({ since: timestamp })).data
          ).toHaveLength(1);
        });
      });

      describe("Pagination", () => {
        it("should not paginate by default", async () => {
          const { data } = await api.listBuckets();
          expect(data.map((bucket) => bucket.id)).toStrictEqual([
            "b4",
            "b3",
            "b2",
            "b1",
          ]);
        });

        it("should paginate by chunks", async () => {
          const { data } = await api.listBuckets({ limit: 2 });
          expect(data.map((bucket) => bucket.id)).toStrictEqual(["b4", "b3"]);
        });

        it("should expose a hasNextPage boolean prop", async () => {
          expect(await api.listBuckets({ limit: 2 })).toHaveProperty(
            "hasNextPage",
            true
          );
        });

        it("should provide a next method to load next page", async () => {
          const res = await api.listBuckets({ limit: 2 });
          const { data } = await res.next();
          expect(data.map((bucket) => bucket.id)).toStrictEqual(["b2", "b1"]);
        });
      });
    });

    describe("#createAccount", () => {
      it("should create an account", async () => {
        await api.createAccount("testuser", "testpw");
        const user = await createClient({
          headers: { Authorization: "Basic " + btoa("testuser:testpw") },
        }).fetchUser();
        expect(user!.id).equal("account:testuser");
      });
    });

    describe("#batch", () => {
      describe("No chunked requests", () => {
        it("should allow batching operations", async () => {
          await api.batch((batch: KintoClientBase) => {
            batch.createBucket("custom");
            const bucket = batch.bucket("custom");
            bucket.createCollection("blog");
            const coll = bucket.collection("blog");
            coll.createRecord({ title: "art1" });
            coll.createRecord({ title: "art2" });
          });

          const { data } = await api
            .bucket("custom")
            .collection("blog")
            .listRecords<TitleRecord>();
          expect(data.map((record) => record.title)).toStrictEqual([
            "art2",
            "art1",
          ]);
        });
      });

      describe("Chunked requests", () => {
        it("should allow batching by chunks", async () => {
          // Note: kinto server configuration has kinto.paginated_by set to 10.
          await api.batch((batch: KintoClientBase) => {
            batch.createBucket("custom");
            const bucket = batch.bucket("custom");
            bucket.createCollection("blog");
            const coll = bucket.collection("blog");
            for (let i = 1; i <= 27; i++) {
              coll.createRecord({ title: "art" + i });
            }
          });

          expect(
            (await api.bucket("custom").collection("blog").listRecords()).data
          ).toHaveLength(10);
        });
      });

      describe("aggregate option", () => {
        describe("Succesful publication", () => {
          describe("No chunking", () => {
            let results: AggregateResponse;

            beforeEach(async () => {
              results = (await api.batch(
                (batch: KintoClientBase) => {
                  batch.createBucket("custom");
                  const bucket = batch.bucket("custom");
                  bucket.createCollection("blog");
                  const coll = bucket.collection("blog");
                  coll.createRecord({ title: "art1" });
                  coll.createRecord({ title: "art2" });
                },
                { aggregate: true }
              )) as AggregateResponse;
            });

            it("should return an aggregated result object", () => {
              expect(results).to.include.keys([
                "errors",
                "conflicts",
                "published",
                "skipped",
              ]);
            });

            it("should contain the list of succesful publications", () => {
              expect(results.published.map((body) => body.data)).toHaveLength(
                4
              );
            });
          });

          describe("Chunked response", () => {
            let results: AggregateResponse;

            beforeEach(async () => {
              results = (await api
                .bucket("default")
                .collection("blog")
                .batch(
                  (batch) => {
                    for (let i = 1; i <= 26; i++) {
                      batch.createRecord({ title: "art" + i });
                    }
                  },
                  { aggregate: true }
                )) as AggregateResponse;
            });

            it("should return an aggregated result object", () => {
              expect(results).toHaveProperty("errors");
              expect(results).toHaveProperty("conflicts");
              expect(results).toHaveProperty("published");
              expect(results).toHaveProperty("skipped");
            });

            it("should contain the list of succesful publications", () => {
              expect(results.published).toHaveLength(26);
            });
          });
        });
      });
    });
  });

  describe("Backed off server", () => {
    const backoffSeconds = 10;

    beforeAll(async () => {
      await startServer(server, { KINTO_BACKOFF: backoffSeconds.toString() });
    });

    afterAll(async () => {
      await stopServer(server);
    });

    beforeEach(async () => {
      if (typeof window !== "undefined") {
        return vitestCommands.flushServer();
      }
      await server.flush();
    });

    it("should appropriately populate the backoff property", async () => {
      // Issuing a first api call to retrieve backoff information
      await api.listBuckets();
      expect(Math.round(api.backoff / 1000)).eql(backoffSeconds);
    });
  });

  describe("Deprecated protocol version", () => {
    beforeEach(async () => {
      if (typeof window !== "undefined") {
        return vitestCommands.flushServer();
      }
      await server.flush();
    });

    describe("Soft EOL", () => {
      let consoleWarnStub: Mock;

      beforeAll(async () => {
        const tomorrow = new Date(new Date().getTime() + 86400000)
          .toJSON()
          .slice(0, 10);
        await startServer(server, {
          KINTO_EOS: `"${tomorrow}"`,
          KINTO_EOS_URL: "http://www.perdu.com",
          KINTO_EOS_MESSAGE: "Boom",
        });
      });

      afterAll(async () => {
        await stopServer(server);
      });

      beforeEach(() => {
        consoleWarnStub = vitest.spyOn(console, "warn");
      });

      it("should warn when the server sends a deprecation Alert header", async () => {
        await api.fetchServerSettings();
        expect(consoleWarnStub).toHaveBeenCalledWith(
          "Boom",
          "http://www.perdu.com"
        );
      });
    });

    describe("Hard EOL", () => {
      beforeAll(async () => {
        const lastWeek = new Date(new Date().getTime() - 7 * 86400000)
          .toJSON()
          .slice(0, 10);
        startServer(server, {
          KINTO_EOS: `"${lastWeek}"`,
          KINTO_EOS_URL: "http://www.perdu.com",
          KINTO_EOS_MESSAGE: "Boom",
        });
      });

      afterAll(() => stopServer(server));

      beforeEach(() => {
        vitest.spyOn(console, "warn");
      });

      it("should reject with a 410 Gone when hard EOL is received", async () => {
        // As of Kinto 13.6.2, EOL responses don't contain CORS headers, so we
        // can only assert than an error is throw.
        await expectAsyncError(
          () => api.fetchServerSettings()
          // /HTTP 410 Gone: Service deprecated/,
          // ServerResponse
        );
      });
    });
  });

  describe("Limited pagination", () => {
    beforeAll(async () => {
      await startServer(server, { KINTO_PAGINATE_BY: "1" });
    });

    afterAll(async () => {
      await stopServer(server);
    });

    beforeEach(async () => {
      if (typeof window !== "undefined") {
        return vitestCommands.flushServer();
      }
      await server.flush();
    });

    describe("Limited configured server pagination", () => {
      let collection: Collection;

      beforeEach(async () => {
        collection = api.bucket("default").collection("posts");
        await collection.batch((batch) => {
          batch.createRecord({ n: 1 });
          batch.createRecord({ n: 2 });
        });
      });

      it("should fetch one results page", async () => {
        const { data } = await collection.listRecords();
        expect(data.map((record) => record.id)).toHaveLength(1);
      });

      it("should fetch all available pages", async () => {
        const { data } = await collection.listRecords({ pages: Infinity });
        expect(data.map((record) => record.id)).toHaveLength(2);
      });
    });
  });

  describe("Chainable API", () => {
    beforeAll(async () => {
      await startServer(server);
    });

    afterAll(async () => {
      await stopServer(server);
    });

    beforeEach(async () => {
      if (typeof window !== "undefined") {
        await vitestCommands.flushServer();
        return;
      }
      await server.flush();
    });

    describe(".bucket()", () => {
      let bucket: Bucket;

      beforeEach(async () => {
        bucket = api.bucket("custom");
        await api.createBucket("custom");
        await bucket.batch((batch) => {
          batch.createCollection("c1", { data: { size: 24 } });
          batch.createCollection("c2", { data: { size: 13 } });
          batch.createCollection("c3", { data: { size: 38 } });
          batch.createCollection("c4", { data: { size: -4 } });
          batch.createGroup("g1", [], { data: { size: 24 } });
          batch.createGroup("g2", [], { data: { size: 13 } });
          batch.createGroup("g3", [], { data: { size: 38 } });
          batch.createGroup("g4", [], { data: { size: -4 } });
        });
      });

      describe(".getData()", () => {
        let result: KintoObject;

        beforeEach(async () => {
          result = await bucket.getData<KintoObject>();
        });

        it("should retrieve the bucket identifier", () => {
          expect(result).toHaveProperty("id", "custom");
        });

        it("should retrieve bucket last_modified value", () => {
          expect(result.last_modified).toBeGreaterThan(1);
        });
      });

      describe(".setData()", () => {
        beforeEach(async () => {
          await bucket.setPermissions({ read: ["github:jon"] });
        });

        it("should post data to the bucket", async () => {
          const res = await bucket.setData({ a: 1 });
          expect((res as KintoResponse).data.a).eql(1);
          expect((res as KintoResponse).permissions.read).includes(
            "github:jon"
          );
        });

        it("should patch existing data for the bucket", async () => {
          await bucket.setData({ a: 1 });
          const res = await bucket.setData({ b: 2 }, { patch: true });
          expect((res as KintoResponse).data.a).eql(1);
          expect((res as KintoResponse).data.b).eql(2);
          expect((res as KintoResponse).permissions.read).includes(
            "github:jon"
          );
        });

        it("should post data to the default bucket", async () => {
          const { data } = await api.bucket("default").setData({ a: 1 });
          expect(data).toHaveProperty("a", 1);
        });
      });

      describe(".getPermissions()", () => {
        it("should retrieve bucket permissions", async () => {
          expect((await bucket.getPermissions()).write).toHaveLength(1);
        });
      });

      describe(".setPermissions()", () => {
        beforeEach(async () => {
          await bucket.setData({ a: 1 });
        });

        it("should set bucket permissions", async () => {
          const res = await bucket.setPermissions({ read: ["github:n1k0"] });
          expect((res as KintoResponse).data.a).eql(1);
          expect((res as KintoResponse).permissions.read).eql(["github:n1k0"]);
        });

        describe("Safe option", () => {
          it("should check for concurrency", async () => {
            await expectAsyncError(
              () =>
                bucket.setPermissions(
                  { read: ["github:n1k0"] },
                  { safe: true, last_modified: 1 }
                ),
              /412 Precondition Failed/
            );
          });
        });
      });

      describe(".addPermissions()", () => {
        beforeEach(async () => {
          await bucket.setPermissions({ read: ["github:n1k0"] });
          await bucket.setData({ a: 1 });
        });

        it("should append bucket permissions", async () => {
          const res = await bucket.addPermissions({ read: ["accounts:gabi"] });
          expect((res as KintoResponse).data.a).eql(1);
          expect((res as KintoResponse).permissions.read!.sort()).eql([
            "accounts:gabi",
            "github:n1k0",
          ]);
        });
      });

      describe(".removePermissions()", () => {
        beforeEach(async () => {
          await bucket.setPermissions({ read: ["github:n1k0"] });
          await bucket.setData({ a: 1 });
        });

        it("should pop bucket permissions", async () => {
          const res = await bucket.removePermissions({ read: ["github:n1k0"] });
          expect((res as KintoResponse).data.a).eql(1);
          expect((res as KintoResponse).permissions.read).toBeUndefined();
        });
      });

      describe(".listHistory()", () => {
        it("should retrieve the list of history entries", async () => {
          const { data } = await bucket.listHistory();
          expect(data.map((entry) => entry.target.data.id)).toStrictEqual([
            "g4",
            "g3",
            "g2",
            "g1",
            "c4",
            "c3",
            "c2",
            "c1",
            "custom",
          ]);
        });

        it("should order entries by field", async () => {
          const { data } = await bucket.listHistory({ sort: "last_modified" });
          expect(data.map((entry) => entry.target.data.id)).toStrictEqual([
            "custom",
            "c1",
            "c2",
            "c3",
            "c4",
            "g1",
            "g2",
            "g3",
            "g4",
          ]);
        });

        describe("Filtering", () => {
          it("should filter entries by top-level attributes", async () => {
            const { data } = await bucket.listHistory({
              filters: { resource_name: "bucket" },
            });
            expect(data.map((entry) => entry.target.data.id)).toStrictEqual([
              "custom",
            ]);
          });

          it("should filter entries by target attributes", async () => {
            const { data } = await bucket.listHistory({
              filters: { "target.data.id": "custom" },
            });
            expect(data.map((entry) => entry.target.data.id)).toStrictEqual([
              "custom",
            ]);
          });

          it("should resolve with entries last_modified value", async () => {
            expectTypeOf(
              (await bucket.listHistory()).last_modified
            ).toBeString();
          });

          it("should retrieve only entries after provided timestamp", async () => {
            const timestamp = (await bucket.listHistory()).last_modified!;
            await bucket.createCollection("c5");
            expect(
              (await bucket.listHistory({ since: timestamp })).data
            ).toHaveLength(1);
          });
        });

        describe("Pagination", () => {
          it("should not paginate by default", async () => {
            const { data } = await bucket.listHistory();
            expect(data.map((entry) => entry.target.data.id)).toHaveLength(9);
          });

          it("should paginate by chunks", async () => {
            const { data } = await bucket.listHistory({ limit: 2 });
            expect(data.map((entry) => entry.target.data.id)).toStrictEqual([
              "g4",
              "g3",
            ]);
          });

          it("should provide a next method to load next page", async () => {
            const res = await bucket.listHistory({ limit: 2 });
            const { data } = await res.next();
            expect(data.map((entry) => entry.target.data.id)).toStrictEqual([
              "g2",
              "g1",
            ]);
          });
        });
      });

      describe(".listCollections()", () => {
        it("should retrieve the list of collections", async () => {
          const { data } = await bucket.listCollections();
          expect(data.map((collection) => collection.id).sort()).toStrictEqual([
            "c1",
            "c2",
            "c3",
            "c4",
          ]);
        });

        it("should order collections by field", async () => {
          const { data } = await bucket.listCollections({ sort: "-size" });
          expect(data.map((collection) => collection.id)).toStrictEqual([
            "c3",
            "c1",
            "c2",
            "c4",
          ]);
        });

        it("should work in a batch", async () => {
          const res = (await api.batch((batch: KintoClientBase) => {
            batch.bucket("custom").listCollections();
          })) as unknown as OperationResponse<KintoObject[]>[];
          expect(res[0].body.data.map((r) => r.id)).toStrictEqual([
            "c4",
            "c3",
            "c2",
            "c1",
          ]);
        });

        describe("Filtering", () => {
          it("should filter collections", async () => {
            const { data } = await bucket.listCollections({
              sort: "size",
              filters: { min_size: 20 },
            });
            expect(data.map((collection) => collection.id)).toStrictEqual([
              "c1",
              "c3",
            ]);
          });

          it("should resolve with collections last_modified value", async () => {
            expectTypeOf(
              (await bucket.listCollections()).last_modified
            ).toBeString();
          });

          it("should retrieve only collections after provided timestamp", async () => {
            const timestamp = (await bucket.listCollections()).last_modified!;
            await bucket.createCollection("c5");
            expect(
              (await bucket.listCollections({ since: timestamp })).data
            ).toHaveLength(1);
          });
        });

        describe("Pagination", () => {
          it("should not paginate by default", async () => {
            const { data } = await bucket.listCollections();
            expect(data.map((collection) => collection.id)).toStrictEqual([
              "c4",
              "c3",
              "c2",
              "c1",
            ]);
          });

          it("should paginate by chunks", async () => {
            const { data } = await bucket.listCollections({ limit: 2 });
            expect(data.map((collection) => collection.id)).toStrictEqual([
              "c4",
              "c3",
            ]);
          });

          it("should provide a next method to load next page", async () => {
            const res = await bucket.listCollections({ limit: 2 });
            const { data } = await res.next();
            expect(data.map((collection) => collection.id)).toStrictEqual([
              "c2",
              "c1",
            ]);
          });
        });
      });

      describe(".createCollection()", () => {
        it("should create a named collection", async () => {
          await bucket.createCollection("foo");
          const { data } = await bucket.listCollections();
          expect(data.map((coll) => coll.id)).includes("foo");
        });

        it("should create an automatically named collection", async () => {
          const res = await bucket.createCollection();
          const generated = (res as KintoResponse).data.id;
          const { data } = await bucket.listCollections();
          expect(data.some((x) => x.id === generated)).eql(true);
        });

        describe("Safe option", () => {
          it("should not override existing collection", async () => {
            await bucket.createCollection("posts");

            await expectAsyncError(
              () => bucket.createCollection("posts", { safe: true }),
              /412 Precondition Failed/
            );
          });
        });

        describe("Permissions option", () => {
          let result: KintoResponse;

          beforeEach(async () => {
            result = await bucket.createCollection("posts", {
              permissions: {
                read: ["github:n1k0"],
              },
            });
          });

          it("should create a collection having a list of write permissions", () => {
            expect(result).toHaveProperty("permissions.read", ["github:n1k0"]);
          });
        });

        describe("Data option", () => {
          let result: KintoResponse;

          beforeEach(async () => {
            result = await bucket.createCollection("posts", {
              data: { foo: "bar" },
            });
          });

          it("should create a collection having the expected data attached", () => {
            expect(result).toHaveProperty("data.foo", "bar");
          });
        });
      });

      describe(".deleteCollection()", () => {
        it("should delete a collection", async () => {
          await bucket.createCollection("foo");
          await bucket.deleteCollection("foo");
          const { data } = await bucket.listCollections();
          expect(data.map((coll) => coll.id)).not.includes("foo");
        });

        describe("Safe option", () => {
          it("should check for concurrency", async () => {
            const res = await bucket.createCollection("posts");

            expectAsyncError(
              () =>
                bucket.deleteCollection("posts", {
                  safe: true,
                  last_modified: res.data.last_modified - 1000,
                }),
              /412 Precondition Failed/
            );
          });
        });
      });

      describe(".listGroups()", () => {
        it("should retrieve the list of groups", async () => {
          const { data } = await bucket.listGroups();
          expect(data.map((group) => group.id).sort()).toStrictEqual([
            "g1",
            "g2",
            "g3",
            "g4",
          ]);
        });

        it("should order groups by field", async () => {
          const { data } = await bucket.listGroups({ sort: "-size" });
          expect(data.map((group) => group.id)).toStrictEqual([
            "g3",
            "g1",
            "g2",
            "g4",
          ]);
        });

        describe("Filtering", () => {
          it("should filter groups", async () => {
            const { data } = await bucket.listGroups({
              sort: "size",
              filters: { min_size: 20 },
            });
            expect(data.map((group) => group.id)).toStrictEqual(["g1", "g3"]);
          });

          it("should resolve with groups last_modified value", async () => {
            expectTypeOf(
              (await bucket.listGroups()).last_modified
            ).toBeString();
          });

          it("should retrieve only groups after provided timestamp", async () => {
            const timestamp = (await bucket.listGroups()).last_modified!;
            await bucket.createGroup("g5", []);
            expect(
              (await bucket.listGroups({ since: timestamp })).data
            ).toHaveLength(1);
          });
        });

        describe("Pagination", () => {
          it("should not paginate by default", async () => {
            const { data } = await bucket.listGroups();
            expect(data.map((group) => group.id)).toStrictEqual([
              "g4",
              "g3",
              "g2",
              "g1",
            ]);
          });

          it("should paginate by chunks", async () => {
            const { data } = await bucket.listGroups({ limit: 2 });
            expect(data.map((group) => group.id)).toStrictEqual(["g4", "g3"]);
          });

          it("should provide a next method to load next page", async () => {
            const res = await bucket.listGroups({ limit: 2 });
            const { data } = await res.next();
            expect(data.map((group) => group.id)).toStrictEqual(["g2", "g1"]);
          });
        });
      });

      describe(".createGroup()", () => {
        it("should create a named group", async () => {
          await bucket.createGroup("foo");
          const { data } = await bucket.listGroups();
          expect(data.map((group) => group.id)).includes("foo");
        });

        it("should create an automatically named group", async () => {
          const res = await bucket.createGroup();
          const generated = (res as KintoResponse<Group>).data.id;
          const { data } = await bucket.listGroups();
          expect(data.some((x) => x.id === generated)).eql(true);
        });

        describe("Safe option", () => {
          it("should not override existing group", async () => {
            await bucket.createGroup("admins");

            await expectAsyncError(
              () => bucket.createGroup("admins", [], { safe: true }),
              /412 Precondition Failed/
            );
          });
        });

        describe("Permissions option", () => {
          let result: KintoResponse<Group>;

          beforeEach(async () => {
            result = await bucket.createGroup("admins", ["twitter:leplatrem"], {
              permissions: {
                read: ["github:n1k0"],
              },
            });
          });

          it("should create a collection having a list of write permissions", () => {
            expect(result)
              .to.have.property("permissions")
              .to.have.property("read")
              .to.eql(["github:n1k0"]);
            expect(result.data.members).to.include("twitter:leplatrem");
          });
        });

        describe("Data option", () => {
          let result: KintoResponse<Group>;

          beforeEach(async () => {
            result = await bucket.createGroup("admins", ["twitter:leplatrem"], {
              data: { foo: "bar" },
            });
          });

          it("should create a collection having the expected data attached", () => {
            expect(result).toHaveProperty("data.foo", "bar");
            expect(result.data.members).includes("twitter:leplatrem");
          });
        });
      });

      describe(".getGroup()", () => {
        it("should get a group", async () => {
          await bucket.createGroup("foo");
          const res = await bucket.getGroup("foo");
          expect((res as KintoResponse<Group>).data.id).eql("foo");
          expect((res as KintoResponse<Group>).data.members).eql([]);
          expect((res as KintoResponse<Group>).permissions.write).toHaveLength(
            1
          );
        });
      });

      describe(".updateGroup()", () => {
        it("should update a group", async () => {
          const res = await bucket.createGroup("foo");
          await bucket.updateGroup({ ...res.data, title: "mod" });
          const { data } = await bucket.listGroups();

          // type Group doesn't have a title property, so we create an
          // intersection type that does
          const firstGroup = data[0] as Group & { title: string };
          expect(firstGroup).toHaveProperty("title", "mod");
        });

        it("should patch a group", async () => {
          const res = await bucket.createGroup("foo", ["github:me"], {
            data: { title: "foo", blah: 42 },
          });
          await bucket.updateGroup(
            { id: (res as KintoResponse<Group>).data.id, blah: 43 },
            { patch: true }
          );
          const { data } = await bucket.listGroups();
          expect(data[0].title).eql("foo");
          expect(data[0].members).eql(["github:me"]);
          expect(data[0].blah).eql(43);
        });

        describe("Safe option", () => {
          const id = "2dcd0e65-468c-4655-8015-30c8b3a1c8f8";

          it("should perform concurrency checks with last_modified", async () => {
            const { data } = await bucket.createGroup("foo");

            await expectAsyncError(
              () =>
                bucket.updateGroup(
                  {
                    id: data.id,
                    members: ["github:me"],
                    title: "foo",
                    last_modified: 1,
                  },
                  { safe: true }
                ),
              /412 Precondition Failed/
            );
          });

          it("should create a non-existent resource when safe is true", async () => {
            expect(
              await bucket.updateGroup({ id, members: ["all"] }, { safe: true })
            ).toHaveProperty("data.members", ["all"]);
          });

          it("should not override existing data with no last_modified", async () => {
            const { data } = await bucket.createGroup("foo");

            await expectAsyncError(
              () =>
                bucket.updateGroup(
                  { id: data.id, members: [], title: "foo" },
                  { safe: true }
                ),
              /412 Precondition Failed/
            );
          });
        });
      });

      describe(".deleteGroup()", () => {
        it("should delete a group", async () => {
          await bucket.createGroup("foo");
          await bucket.deleteGroup("foo");
          const { data } = await bucket.listGroups();
          expect(data.map((coll) => coll.id)).not.includes("foo");
        });

        describe("Safe option", () => {
          it("should check for concurrency", async () => {
            const { data } = await bucket.createGroup("posts");

            await expectAsyncError(
              () =>
                bucket.deleteGroup("posts", {
                  safe: true,
                  last_modified: data.last_modified - 1000,
                }),
              /412 Precondition Failed/
            );
          });
        });
      });

      describe(".batch()", () => {
        it("should allow batching operations for current bucket", async () => {
          await bucket.batch((batch) => {
            batch.createCollection("comments");
            const coll = batch.collection("comments");
            coll.createRecord({ content: "plop" });
            coll.createRecord({ content: "yo" });
          });

          const { data } = await bucket.collection("comments").listRecords();
          expect(data.map((comment) => comment.content).sort()).toStrictEqual([
            "plop",
            "yo",
          ]);
        });

        describe("Safe option", () => {
          it("should allow batching operations for current bucket", async () => {
            expect(
              (
                await bucket.batch(
                  (batch) => {
                    batch.createCollection("comments");
                    batch.createCollection("comments");
                  },
                  { safe: true, aggregate: true }
                )
              ).conflicts
            ).toHaveLength(1);
          });
        });
      });
    });

    describe(".collection()", () => {
      function runSuite(label: string, collPromise: () => Promise<Collection>) {
        describe(label, () => {
          let coll: Collection;

          beforeEach(async () => {
            coll = await collPromise();
          });

          describe(".getTotalRecords()", () => {
            it("should retrieve the initial total number of records", async () => {
              expect(await coll.getTotalRecords()).toBe(0);
            });

            it("should retrieve the updated total number of records", async () => {
              await coll.batch((batch) => {
                batch.createRecord({ a: 1 });
                batch.createRecord({ a: 2 });
              });
              expect(await coll.getTotalRecords()).eql(2);
            });
          });

          describe(".getPermissions()", () => {
            it("should retrieve permissions", async () => {
              expect((await coll.getPermissions()).write).toHaveLength(1);
            });
          });

          describe(".setPermissions()", () => {
            beforeEach(async () => {
              await coll.setData({ a: 1 });
            });

            it("should set typed permissions", async () => {
              const res = await coll.setPermissions({ read: ["github:n1k0"] });
              expect((res as KintoResponse).data.a).eql(1);
              expect((res as KintoResponse).permissions.read).eql([
                "github:n1k0",
              ]);
            });

            describe("Safe option", () => {
              it("should perform concurrency checks", async () => {
                await expectAsyncError(
                  () =>
                    coll.setPermissions(
                      { read: ["github:n1k0"] },
                      { safe: true, last_modified: 1 }
                    ),
                  /412 Precondition Failed/
                );
              });
            });
          });

          describe(".addPermissions()", () => {
            beforeEach(async () => {
              await coll.setPermissions({ read: ["github:n1k0"] });
              await coll.setData({ a: 1 });
            });

            it("should append collection permissions", async () => {
              const res = await coll.addPermissions({
                read: ["accounts:gabi"],
              });
              expect((res as KintoResponse).data.a).eql(1);
              expect((res as KintoResponse).permissions.read!.sort()).eql([
                "accounts:gabi",
                "github:n1k0",
              ]);
            });
          });

          describe(".removePermissions()", () => {
            beforeEach(async () => {
              await coll.setPermissions({ read: ["github:n1k0"] });
              await coll.setData({ a: 1 });
            });

            it("should pop collection permissions", async () => {
              const res = await coll.removePermissions({
                read: ["github:n1k0"],
              });
              expect((res as KintoResponse).data.a).eql(1);
              expect((res as KintoResponse).permissions.read).toBeUndefined();
            });
          });

          describe(".getData()", () => {
            it("should retrieve collection data", async () => {
              await coll.setData({ signed: true });
              const data = (await coll.getData()) as { signed: boolean };
              expect(data).toHaveProperty("signed", true);
            });
          });

          describe(".setData()", () => {
            beforeEach(async () => {
              await coll.setPermissions({ read: ["github:n1k0"] });
            });

            it("should set collection data", async () => {
              const res = await coll.setData({ signed: true });
              expect((res as KintoResponse).data.signed).eql(true);
              expect((res as KintoResponse).permissions.read).to.include(
                "github:n1k0"
              );
            });

            describe("Safe option", () => {
              it("should perform concurrency checks", async () => {
                await expectAsyncError(
                  () =>
                    coll.setData(
                      { signed: true },
                      { safe: true, last_modified: 1 }
                    ),
                  /412 Precondition Failed/
                );
              });
            });
          });

          describe(".createRecord()", () => {
            describe("No record id provided", () => {
              it("should create a record", async () => {
                expect(
                  await coll.createRecord({ title: "foo" })
                ).toHaveProperty("data.title", "foo");
              });

              describe("Safe option", () => {
                it("should check for existing record", async () => {
                  const { data } = await coll.createRecord({ title: "foo" });

                  await expectAsyncError(
                    () =>
                      coll.createRecord(
                        { id: data.id, title: "foo" },
                        { safe: true }
                      ),
                    /412 Precondition Failed/
                  );
                });
              });
            });

            describe("Record id provided", () => {
              const record = {
                id: "37f727ed-c8c4-461b-80ac-de874992165c",
                title: "foo",
              };

              it("should create a record", async () => {
                expect(await coll.createRecord(record)).toHaveProperty(
                  "data.title",
                  "foo"
                );
              });
            });
          });

          describe(".updateRecord()", () => {
            it("should update a record", async () => {
              const res = await coll.createRecord({ title: "foo" });
              await coll.updateRecord({ ...res.data, title: "mod" });
              const { data } = await coll.listRecords();
              // type KintoObject doesn't have a title property, so we create
              // an intersection type that does
              const record = data[0] as KintoObject & { title: string };
              expect(record.title).toBe("mod");
            });

            it("should patch a record", async () => {
              const res = await coll.createRecord({ title: "foo", blah: 42 });
              await coll.updateRecord(
                { id: (res as KintoResponse).data.id, blah: 43 },
                { patch: true }
              );
              const { data } = await coll.listRecords();
              expect(data[0].title).eql("foo");
              expect(data[0].blah).eql(43);
            });

            it("should create the record if it doesn't exist yet", async () => {
              const id = "2dcd0e65-468c-4655-8015-30c8b3a1c8f8";

              const { data } = await coll.updateRecord({ id, title: "blah" });
              expect(await coll.getRecord(data.id)).toHaveProperty(
                "data.title",
                "blah"
              );
            });

            describe("Safe option", () => {
              const id = "2dcd0e65-468c-4655-8015-30c8b3a1c8f8";

              it("should perform concurrency checks with last_modified", async () => {
                const { data } = await coll.createRecord({ title: "foo" });

                await expectAsyncError(
                  () =>
                    coll.updateRecord(
                      { id: data.id, title: "foo", last_modified: 1 },
                      { safe: true }
                    ),
                  /412 Precondition Failed/
                );
              });

              it("should create a non-existent resource when safe is true", async () => {
                expect(
                  await coll.updateRecord({ id, title: "foo" }, { safe: true })
                ).toHaveProperty("data.title", "foo");
              });

              it("should not override existing data with no last_modified", async () => {
                const { data } = await coll.createRecord({ title: "foo" });

                await expectAsyncError(
                  () =>
                    coll.updateRecord(
                      { id: data.id, title: "foo" },
                      { safe: true }
                    ),
                  /412 Precondition Failed/
                );
              });
            });
          });

          describe(".deleteRecord()", () => {
            it("should delete a record", async () => {
              const { data } = await coll.createRecord({ title: "foo" });
              await coll.deleteRecord(data.id);
              expect(await coll.listRecords()).toHaveProperty("data", []);
            });

            describe("Safe option", () => {
              it("should perform concurrency checks", async () => {
                const { data } = await coll.createRecord({ title: "foo" });

                await expectAsyncError(
                  () =>
                    coll.deleteRecord(data.id, {
                      last_modified: 1,
                      safe: true,
                    }),
                  /412 Precondition Failed/
                );
              });
            });
          });

          describe(".addAttachment()", () => {
            describe("With filename", () => {
              const input = "test";
              const dataURL =
                "data:text/plain;name=test.txt;base64," + btoa(input);

              let result: KintoResponse<{ attachment: Attachment }>;

              beforeEach(async () => {
                result = await coll.addAttachment(
                  dataURL,
                  { foo: "bar" },
                  { permissions: { write: ["github:n1k0"] } }
                );

                if (typeof window == "undefined") {
                  vitest.spyOn(global, "Blob").mockImplementation(fakeBlob);
                }
              });

              it("should create a record with an attachment", () => {
                expect(result).toHaveProperty(
                  "data.attachment.size",
                  input.length
                );
              });

              it("should create a record with provided record data", () => {
                expect(result).toHaveProperty("data.foo", "bar");
              });

              it("should create a record with provided permissions", () => {
                expect(result).toHaveProperty(
                  "permissions.write",
                  expect.arrayContaining(["github:n1k0"])
                );
              });
            });

            describe("Without filename", () => {
              const dataURL = "data:text/plain;base64," + btoa("blah");

              it("should default filename to 'untitled' if not specified", async () => {
                expect(await coll.addAttachment(dataURL)).toHaveProperty(
                  "data.attachment.filename",
                  "untitled"
                );
              });

              it("should allow to specify safe in options", async () => {
                expect(
                  await coll.addAttachment(dataURL, undefined, { safe: true })
                ).toHaveProperty("data.attachment.size", 4);
              });

              it("should allow to specify a filename in options", async () => {
                expect(
                  await coll.addAttachment(dataURL, undefined, {
                    filename: "MYFILE.DAT",
                  })
                ).toHaveProperty("data.attachment.filename", "MYFILE.DAT");
              });
            });
          });

          describe(".removeAttachment()", () => {
            const input = "test";
            const dataURL =
              "data:text/plain;name=test.txt;base64," + btoa(input);

            let recordId: string;

            beforeEach(async () => {
              const res = await coll.addAttachment(dataURL);
              recordId = (
                res as KintoResponse<{
                  attachment: Attachment;
                }>
              ).data.id;
            });

            it("should remove an attachment from a record", async () => {
              await coll.removeAttachment(recordId);
              expect(await coll.getRecord(recordId)).toHaveProperty(
                "data.attachment",
                null
              );
            });
          });

          describe(".getRecord()", () => {
            it("should retrieve a record by its id", async () => {
              const { data } = await coll.createRecord({ title: "blah" });

              expect(await coll.getRecord(data.id)).toHaveProperty(
                "data.title",
                "blah"
              );
            });
          });

          describe(".listRecords()", () => {
            it("should list records", async () => {
              await coll.createRecord({ title: "foo" });

              const { data } = await coll.listRecords();
              expect(data.map((record) => record.title)).toStrictEqual(["foo"]);
            });

            it("should order records by field", async () => {
              await Promise.all(
                ["art3", "art1", "art2"].map((title) => {
                  return coll.createRecord({ title });
                })
              );

              const { data } = await coll.listRecords({ sort: "title" });
              expect(data.map((record) => record.title)).toStrictEqual([
                "art1",
                "art2",
                "art3",
              ]);
            });

            describe("Filtering", () => {
              beforeEach(async () => {
                await coll.batch((batch) => {
                  batch.createRecord({ name: "paul", age: 28 });
                  batch.createRecord({ name: "jess", age: 54 });
                  batch.createRecord({ name: "john", age: 33 });
                  batch.createRecord({ name: "rené", age: 24 });
                });
              });

              it("should filter records", async () => {
                const { data } = await coll.listRecords({
                  sort: "age",
                  filters: { min_age: 30 },
                });
                expect(data.map((record) => record.name)).toStrictEqual([
                  "john",
                  "jess",
                ]);
              });

              it("should properly escape unicode filters", async () => {
                const { data } = await coll.listRecords({
                  filters: { name: "rené" },
                });
                expect(data.map((record) => record.name)).toStrictEqual([
                  "rené",
                ]);
              });

              it("should resolve with collection last_modified value", async () => {
                expectTypeOf(
                  (await coll.listRecords()).last_modified
                ).toBeString();
              });
            });

            describe("since", () => {
              let ts1: string, ts2: string;

              beforeEach(async () => {
                ts1 = (await coll.listRecords()).last_modified!;
                await coll.createRecord({ n: 1 });
                ts2 = (await coll.listRecords()).last_modified!;
                await coll.createRecord({ n: 2 });
              });

              it("should retrieve all records modified since provided timestamp", async () => {
                expect(
                  (await coll.listRecords({ since: ts1 })).data
                ).toHaveLength(2);
              });

              it("should only list changes made after the provided timestamp", async () => {
                expect(
                  (await coll.listRecords({ since: ts2 })).data
                ).toHaveLength(1);
              });
            });

            describe("'at' retrieves a snapshot at a given timestamp", () => {
              let rec1: KintoObject, rec2: KintoObject, rec3: KintoObject;

              beforeEach(async () => {
                rec1 = (await coll.createRecord({ n: 1 })).data;
                rec2 = (await coll.createRecord({ n: 2 })).data;
                rec3 = (await coll.createRecord({ n: 3 })).data;
              });

              it("should resolve with a regular list result object", async () => {
                const result = await coll.listRecords({
                  at: rec3.last_modified,
                });
                const expectedSnapshot = [rec3, rec2, rec1];
                expect(result.data).to.eql(expectedSnapshot);
                expect(result.last_modified).eql(String(rec3.last_modified));
                expect(result.hasNextPage).eql(false);
                expect(result.totalRecords).eql(expectedSnapshot.length);
                expect(() => result.next()).toThrowError(/pagination/);
              });

              it("should handle creations", async () => {
                expect(
                  await coll.listRecords({ at: rec1.last_modified })
                ).toHaveProperty("data", [rec1]);
              });

              it("should handle updates", async () => {
                const res = await coll.updateRecord({ ...rec2, n: 42 });
                const updatedRec2 = (res as KintoResponse).data;
                const { data } = await coll.listRecords({
                  at: updatedRec2.last_modified,
                });
                expect(data).toStrictEqual([updatedRec2, rec3, rec1]);
              });

              it("should handle deletions", async () => {
                const res = await coll.deleteRecord(rec1.id);
                const { data } = await coll.listRecords({
                  at: (res as KintoResponse).data.last_modified,
                });
                expect(data).toStrictEqual([rec3, rec2]);
              });

              it("should handle re-creations", async () => {
                await coll.deleteRecord(rec1.id);
                await coll.createRecord({ id: rec1.id, n: 1 });
                const { data } = await coll.listRecords({
                  at: rec3.last_modified,
                });
                expect(data).toStrictEqual([rec3, rec2, rec1]);
              });

              it("should handle plural delete before timestamp", async () => {
                await coll.createRecord({ n: 3 });
                await coll.deleteRecords({
                  filters: {
                    eq_n: 3,
                  },
                });
                const { data: rec4 } = await coll.createRecord({ n: 4 });
                const { data } = await coll.listRecords({
                  at: rec4.last_modified,
                });
                expect(data).toStrictEqual([rec4, rec2, rec1]);
              });

              it("should handle plural delete after timestamp", async () => {
                const { data: rec33 } = await coll.createRecord({ n: 3 });
                await coll.createRecord({ n: 4 });
                await coll.deleteRecords({
                  filters: {
                    eq_n: 3,
                  },
                });
                const { data } = await coll.listRecords({
                  at: rec33.last_modified,
                });
                expect(data).toStrictEqual([rec33, rec3, rec2, rec1]);
              });

              it("should handle long list of changes", async () => {
                const res = await coll.batch((batch) => {
                  for (let n = 4; n <= 100; n++) {
                    batch.createRecord({ n });
                  }
                });
                const at = (res as OperationResponse[])[50].body.data
                  .last_modified;
                expect((await coll.listRecords({ at })).data).toHaveLength(54);
              });

              describe("Mixed CRUD operations", () => {
                let rec4: KintoObject;
                let s1: KintoObject[] = [],
                  s2: KintoObject[] = [],
                  s3: KintoObject[] = [],
                  s4: KintoObject[] = [];
                let rec1up: KintoObject;

                beforeEach(async () => {
                  const responses = await coll.batch((batch) => {
                    batch.deleteRecord(rec2.id);
                    batch.updateRecord({
                      ...rec1,
                      foo: "bar",
                    });
                    batch.createRecord({ n: 4 });
                  });
                  rec1up = (responses as OperationResponse[])[1].body.data;
                  rec4 = (responses as OperationResponse[])[
                    (responses as OperationResponse[]).length - 1
                  ].body.data;
                  const results = await Promise.all([
                    coll.listRecords({ at: rec1.last_modified }),
                    coll.listRecords({ at: rec2.last_modified }),
                    coll.listRecords({ at: rec3.last_modified }),
                    coll.listRecords({ at: rec4.last_modified }),
                  ]);
                  const snapshots = results.map(({ data }) => data);
                  s1 = snapshots[0];
                  s2 = snapshots[1];
                  s3 = snapshots[2];
                  s4 = snapshots[3];
                });

                it("should compute snapshot1 as expected", () => {
                  expect(s1).toStrictEqual([rec1]);
                });

                it("should compute snapshot2 as expected", () => {
                  expect(s2).toStrictEqual([rec2, rec1]);
                });

                it("should compute snapshot3 as expected", () => {
                  expect(s3).toStrictEqual([rec3, rec2, rec1]);
                });

                it("should compute snapshot4 as expected", () => {
                  expect(s4).toStrictEqual([rec4, rec1up, rec3]);
                });
              });
            });

            describe("Pagination", () => {
              beforeEach(async () => {
                await coll.batch((batch) => {
                  for (let i = 1; i <= 3; i++) {
                    batch.createRecord({ n: i });
                  }
                });
              });

              it("should not paginate by default", async () => {
                const { data } = await coll.listRecords();
                expect(data.map((record) => record.n)).toStrictEqual([3, 2, 1]);
              });

              it("should paginate by chunks", async () => {
                const { data } = await coll.listRecords({ limit: 2 });
                expect(data.map((record) => record.n)).toStrictEqual([3, 2]);
              });

              it("should provide a next method to load next page", async () => {
                const res = await coll.listRecords({ limit: 2 });
                const { data } = await res.next();
                expect(data.map((record) => record.n)).toStrictEqual([1]);
              });

              it("should resolve with an empty array on exhausted pagination", async () => {
                const res1 = await coll.listRecords({ limit: 2 });
                const res2 = await res1.next();

                await expectAsyncError(
                  () => res2.next(),
                  /Pagination exhausted./
                );
              });

              it("should retrieve all pages", async () => {
                // Note: Server has no limit by default, so here we get all the
                // records.
                const { data } = await coll.listRecords();
                expect(data.map((record) => record.n)).toStrictEqual([3, 2, 1]);
              });

              it("should retrieve specified number of pages", async () => {
                const { data } = await coll.listRecords({ limit: 1, pages: 2 });
                expect(data.map((record) => record.n)).toStrictEqual([3, 2]);
              });

              it("should allow fetching next page after last page if any", async () => {
                const { next } = await coll.listRecords({ limit: 1, pages: 1 });
                const { data } = await next();
                expect(data.map((record) => record.n)).toStrictEqual([3, 2]);
              });

              it("should should retrieve all existing pages", async () => {
                const { data } = await coll.listRecords({
                  limit: 1,
                  pages: Infinity,
                });
                expect(data.map((record) => record.n)).toStrictEqual([3, 2, 1]);
              });
            });
          });

          describe(".batch()", () => {
            it("should allow batching operations in the current collection", async () => {
              await coll.batch((batch) => {
                batch.createRecord({ title: "a" });
                batch.createRecord({ title: "b" });
              });
              const { data } = await coll.listRecords({ sort: "title" });
              expect(data.map((record) => record.title)).toStrictEqual([
                "a",
                "b",
              ]);
            });
          });
        });
      }

      runSuite("default bucket", async () => {
        await api.bucket("default").createCollection("plop");
        return api.bucket("default").collection("plop");
      });

      runSuite("custom bucket", async () => {
        await api.createBucket("custom");
        await api.bucket("custom").createCollection("plop");
        return api.bucket("custom").collection("plop");
      });
    });
  });
});
