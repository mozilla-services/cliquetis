/* eslint dot-notation: off */
import { v4 as uuid4 } from "uuid";
import KintoServer from "kinto-node-test-server";
import {
  Collection as KintoClientCollection,
  KintoIdObject,
} from "../src/http";
import mitt from "mitt";
import Kinto from "../src";
import Collection, {
  recordsEqual,
  ServerWasFlushedError,
  SyncResultObject,
} from "../src/collection";
import { IdSchema } from "../src/types";
import { expectAsyncError } from "./test_utils";
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

const TEST_KINTO_SERVER =
  process.env.TEST_KINTO_SERVER || "http://0.0.0.0:8888/v1";
const KINTO_PROXY_SERVER = process.env.KINTO_PROXY_SERVER || TEST_KINTO_SERVER;

const appendTransformer = function (s: string) {
  return {
    encode(record: any) {
      return Promise.resolve({ ...record, title: (record.title || "") + s });
    },
    decode(record: any) {
      if (record.title) {
        let newTitle = record.title;
        if (record.title.slice(-s.length) === s) {
          newTitle = record.title.slice(0, -1);
        }
        return Promise.resolve({ ...record, title: newTitle });
      }
      return Promise.resolve(record);
    },
  };
};

/**
 * Verify that syncing again is a no-op.
 */
function futureSyncsOK(
  getCollection: () => Collection,
  getLastSyncResult: () => SyncResultObject
) {
  describe("On next MANUAL sync", () => {
    let nextSyncResult: SyncResultObject;

    beforeEach(async () => {
      nextSyncResult = await getCollection().sync();
    });

    it("should have an ok status", () => {
      expect(nextSyncResult.ok).eql(true);
    });

    it("should contain no errors", () => {
      expect(nextSyncResult.errors).toHaveLength(0);
    });

    it("should have the same lastModified value", () => {
      expect(nextSyncResult.lastModified).eql(getLastSyncResult().lastModified);
    });

    it("should not contain conflicts anymore", () => {
      expect(nextSyncResult.conflicts).toHaveLength(0);
    });

    it("should not skip anything", () => {
      expect(nextSyncResult.skipped).toHaveLength(0);
    });

    it("should not import anything", () => {
      expect(nextSyncResult.created).toHaveLength(0);
    });

    it("should not publish anything", () => {
      expect(nextSyncResult.published).toHaveLength(0);
    });

    it("should not update anything", () => {
      expect(nextSyncResult.updated).toHaveLength(0);
    });
  });
}

describe("Integration tests", () => {
  let server: KintoServer,
    kinto: Kinto,
    tasks: Collection,
    tasksTransformed: Collection;

  beforeAll(async () => {
    let kintoConfigPath = __dirname + "/kinto.ini";
    if (process.env.SERVER && process.env.SERVER !== "master") {
      kintoConfigPath = `${__dirname}/kinto-${process.env.SERVER}.ini`;
    }
    server = new KintoServer(KINTO_PROXY_SERVER, { kintoConfigPath });
    await server.loadConfig(kintoConfigPath);
  });

  afterAll(async () => {
    const logLines = (await server.logs()).split("\n");
    const serverDidCrash = logLines.some((l) => l.includes("Traceback"));
    if (serverDidCrash) {
      // Server errors have been encountered, raise to break the build
      const trace = logLines.join("\n");
      throw new Error(
        `Kinto server crashed while running the test suite.\n\n${trace}`
      );
    }
    return server.killAll();
  });

  beforeEach(() => {
    kinto = new Kinto({
      remote: TEST_KINTO_SERVER,
      headers: { Authorization: "Basic " + btoa("user:pass") },
      events: mitt(),
    });
    tasks = kinto.collection("tasks");
    tasksTransformed = kinto.collection("tasks-transformer", {
      remoteTransformers: [appendTransformer("!")],
    });
  });

  afterEach(() => {
    vitest.restoreAllMocks();
  });

  describe("Default server configuration", () => {
    beforeAll(async () => {
      await server.start({});
    });

    afterAll(async () => {
      await server.stop();
    });

    beforeEach(async () => {
      await tasks.clear();
      await tasksTransformed.clear();
      await server.flush();
    });

    describe("Synchronization", () => {
      function testSync(data: any, options: any = {}) {
        return collectionTestSync(tasks, data, options);
      }

      async function collectionTestSync(
        collection: Collection,
        data: any,
        options?: Parameters<typeof collection.sync>[0]
      ) {
        // Create remote records
        await collection.api
          .bucket("default")
          .collection(collection["_name"])
          .batch(
            (batch) => {
              data.localSynced.forEach((r: any) => batch.createRecord(r));
            },
            { safe: true }
          );
        await collection.sync(options);
        await Promise.all(
          ([] as Promise<any>[]).concat(
            // Create local unsynced records
            data.localUnsynced.map((record: any) =>
              collection.create(record, { useRecordId: true })
            ),
            // Create remote records
            collection.api
              .bucket("default")
              .collection(collection["_name"])
              .batch(
                (batch_1) => {
                  data.server.forEach((r: any) => batch_1.createRecord(r));
                },
                { safe: true }
              )
          )
        );
        return collection.sync(options);
      }

      async function getRemoteList(
        collection = "tasks"
      ): Promise<{ title: string; done: boolean }[]> {
        const res = await fetch(
          `${TEST_KINTO_SERVER}/buckets/default/collections/${collection}/records?_sort=title`,
          {
            headers: { Authorization: "Basic " + btoa("user:pass") },
          }
        );
        const json = await res.json();
        return json.data.map((record: any) => ({
          title: record.title,
          done: record.done,
        }));
      }

      describe("No change", () => {
        const testData: { [key: string]: KintoIdObject[] } = {
          localSynced: [],
          localUnsynced: [],
          server: [{ id: uuid4(), title: "task1", done: true }],
        };
        let syncResult1: SyncResultObject;
        let syncResult2: SyncResultObject;

        beforeEach(async () => {
          // Sync twice.
          syncResult1 = await testSync(testData);
          syncResult2 = await tasks.sync();
        });

        it("should have an ok status", () => {
          expect(syncResult2.ok).eql(true);
        });

        it("should not contain conflicts", () => {
          expect(syncResult2.conflicts).toHaveLength(0);
        });

        it("should have same lastModified value", () => {
          expect(syncResult1.lastModified).eql(syncResult2.lastModified);
        });
      });

      describe("No conflict", () => {
        const testData: { [key: string]: KintoIdObject[] } = {
          localSynced: [
            { id: uuid4(), title: "task2", done: false },
            { id: uuid4(), title: "task3", done: true },
          ],
          localUnsynced: [{ id: uuid4(), title: "task4", done: false }],
          server: [{ id: uuid4(), title: "task1", done: true }],
        };
        let syncResult: SyncResultObject;

        beforeEach(async () => {
          syncResult = await testSync(testData);
        });

        it("should have an ok status", () => {
          expect(syncResult.ok).eql(true);
        });

        it("should contain no errors", () => {
          expect(syncResult.errors).toHaveLength(0);
        });

        it("should have a valid lastModified value", () => {
          expect(syncResult.lastModified).to.be.a("number");
        });

        it("should not contain conflicts", () => {
          expect(syncResult.conflicts).toHaveLength(0);
        });

        it("should not skip records", () => {
          expect(syncResult.skipped).toHaveLength(0);
        });

        it("should import server data", () => {
          expect(syncResult.created).toHaveLength(1);
          expect(syncResult.created[0]).toHaveProperty(
            "title",
            testData.server[0].title
          );

          expect(syncResult.created[0]).toHaveProperty(
            "done",
            testData.server[0].done
          );
        });

        it("should publish local unsynced records", () => {
          expect(syncResult.published).toHaveLength(1);
          expect(
            recordsEqual(syncResult.published[0], testData.localUnsynced[0])
          ).eql(true);
        });

        it("should publish deletion of locally deleted records", async () => {
          const locallyDeletedId = testData.localSynced[0].id;
          await tasks.delete(locallyDeletedId);
          await tasks.sync();
          const list = await getRemoteList();
          expect(list).toStrictEqual([
            { title: "task1", done: true },
            { title: "task3", done: true },
            { title: "task4", done: false },
          ]);
        });

        it("should not update anything", () => {
          expect(syncResult.updated).toHaveLength(0);
        });

        it("should put local database in the expected state", async () => {
          const res = await tasks.list({ order: "title" });
          expect(
            res.data.map((record) => ({
              title: record.title,
              done: record.done,
              _status: record._status,
            }))
          ).toStrictEqual([
            { title: "task1", _status: "synced", done: true },
            { title: "task2", _status: "synced", done: false },
            { title: "task3", _status: "synced", done: true },
            { title: "task4", _status: "synced", done: false },
          ]);
        });

        it("should put remote test server data in the expected state", async () => {
          const list = await getRemoteList();
          expect(list).toStrictEqual([
            // task1, task2, task3 were prexisting.
            { title: "task1", done: true },
            { title: "task2", done: false },
            { title: "task3", done: true },
            { title: "task4", done: false }, // published via sync.
          ]);
        });

        it("should fetch every server page", async () => {
          await collectionTestSync(tasks, {
            localUnsynced: [],
            localSynced: [],
            server: Array(10)
              .fill(undefined)
              .map((e, i) => ({ id: uuid4(), title: `task${i}`, done: true })),
          });

          const list = await tasks.list();
          expect(list.data).toHaveLength(10 + 4);
        });

        futureSyncsOK(
          () => tasks,
          () => syncResult
        );
      });

      describe("Incoming conflict", () => {
        const conflictingId = uuid4();
        const testData: { [key: string]: KintoIdObject[] } = {
          localSynced: [
            { id: uuid4(), title: "task1", done: true },
            { id: uuid4(), title: "task2", done: false },
            { id: uuid4(), title: "task3", done: true },
          ],
          localUnsynced: [
            { id: conflictingId, title: "task4-local", done: false },
          ],
          server: [{ id: conflictingId, title: "task4-remote", done: true }],
        };
        let syncResult: SyncResultObject;

        describe("PULL_ONLY strategy (default)", () => {
          beforeEach(async () => {
            syncResult = await testSync(testData, {
              strategy: Kinto.syncStrategy.PULL_ONLY,
            });
          });

          it("should have an ok status", () => {
            expect(syncResult.ok).eql(true);
          });

          it("should contain no errors", () => {
            expect(syncResult.errors).toHaveLength(0);
          });

          it("should have a valid lastModified value", () => {
            expect(syncResult.lastModified).to.be.a("number");
          });

          it("should have no conflicts", () => {
            expect(syncResult.conflicts).toHaveLength(0);
            expect(syncResult.resolved).toHaveLength(0);
            expect(syncResult.published).toHaveLength(0);
            expect(syncResult.updated).toHaveLength(1);
            expect(
              recordsEqual(syncResult.updated[0].old, {
                id: conflictingId,
                title: "task4-local",
                done: false,
              })
            ).eql(true);
            expect(
              recordsEqual(syncResult.updated[0].new, {
                id: conflictingId,
                title: "task4-remote",
                done: true,
              })
            ).eql(true);
          });
        });

        describe("MANUAL strategy (default)", () => {
          beforeEach(async () => {
            syncResult = await testSync(testData);
          });

          it("should not have an ok status", () => {
            expect(syncResult.ok).eql(false);
          });

          it("should contain no errors", () => {
            expect(syncResult.errors).toHaveLength(0);
          });

          it("should have a valid lastModified value", () => {
            expect(syncResult.lastModified).to.be.a("number");
          });

          it("should have the incoming conflict listed", () => {
            expect(syncResult.conflicts).toHaveLength(1);
            expect(syncResult.conflicts[0].type).eql("incoming");
            expect(
              recordsEqual(syncResult.conflicts[0].local, {
                id: conflictingId,
                title: "task4-local",
                done: false,
              })
            ).eql(true);
            expect(
              recordsEqual(syncResult.conflicts[0].remote, {
                id: conflictingId,
                title: "task4-remote",
                done: true,
              })
            ).eql(true);
          });

          it("should not skip records", () => {
            expect(syncResult.skipped).toHaveLength(0);
          });

          it("should not import anything", () => {
            expect(syncResult.created).toHaveLength(0);
          });

          it("should not publish anything", () => {
            expect(syncResult.published).toHaveLength(0);
          });

          it("should not update anything", () => {
            expect(syncResult.updated).toHaveLength(0);
          });

          it("should not merge anything", () => {
            expect(syncResult.resolved).toHaveLength(0);
          });

          it("should put local database in the expected state", async () => {
            const res = await tasks.list({ order: "title" });
            expect(
              res.data.map((record) => ({
                title: record.title,
                done: record.done,
                _status: record._status,
              }))
            ).toStrictEqual([
              { title: "task1", _status: "synced", done: true },
              { title: "task2", _status: "synced", done: false },
              { title: "task3", _status: "synced", done: true },
              // For MANUAL strategy, local conficting record is left intact
              { title: "task4-local", _status: "created", done: false },
            ]);
          });

          it("should put remote test server data in the expected state", async () => {
            const list = await getRemoteList();
            expect(list).toStrictEqual([
              // task1, task2, task3 were prexisting.
              { title: "task1", done: true },
              { title: "task2", done: false },
              { title: "task3", done: true },
              // Remote record should have been left intact.
              { title: "task4-remote", done: true },
            ]);
          });

          describe("On next MANUAL sync", () => {
            let nextSyncResult: SyncResultObject;

            beforeEach(async () => {
              const result = await tasks.sync();
              nextSyncResult = result;
            });

            it("should not have an ok status", () => {
              expect(nextSyncResult.ok).eql(false);
            });

            it("should contain no errors", () => {
              expect(nextSyncResult.errors).toHaveLength(0);
            });

            it("should not have bumped the lastModified value", () => {
              expect(nextSyncResult.lastModified).eql(syncResult.lastModified);
            });

            it("should preserve unresolved conflicts", () => {
              expect(nextSyncResult.conflicts).toHaveLength(1);
            });

            it("should not skip anything", () => {
              expect(nextSyncResult.skipped).toHaveLength(0);
            });

            it("should not import anything", () => {
              expect(nextSyncResult.created).toHaveLength(0);
            });

            it("should not publish anything", () => {
              expect(nextSyncResult.published).toHaveLength(0);
            });

            it("should not update anything", () => {
              expect(nextSyncResult.updated).toHaveLength(0);
            });
          });
        });

        describe("CLIENT_WINS strategy", () => {
          beforeEach(async () => {
            syncResult = await testSync(testData, {
              strategy: Kinto.syncStrategy.CLIENT_WINS,
            });
          });

          it("should have an ok status", () => {
            expect(syncResult.ok).eql(true);
          });

          it("should contain no errors", () => {
            expect(syncResult.errors).toHaveLength(0);
          });

          it("should have a valid lastModified value", () => {
            expect(syncResult.lastModified).to.be.a("number");
          });

          it("should have updated lastModified", async () => {
            expect(tasks.lastModified).toBe(syncResult.lastModified);
            const lastModified = await tasks.db.getLastModified();
            expect(lastModified).toBe(syncResult.lastModified);
          });

          it("should have no incoming conflict listed", () => {
            expect(syncResult.conflicts).toHaveLength(0);
          });

          it("should not skip records", () => {
            expect(syncResult.skipped).toHaveLength(0);
          });

          it("should not import anything", () => {
            expect(syncResult.created).toHaveLength(0);
          });

          it("should publish resolved conflict using local version", () => {
            expect(syncResult.published).toHaveLength(1);
            expect(
              recordsEqual(syncResult.published[0], {
                id: conflictingId,
                title: "task4-local",
                done: false,
              })
            ).eql(true);
          });

          it("should not update anything", () => {
            expect(syncResult.updated).toHaveLength(0);
          });

          it("should list resolved records", () => {
            expect(syncResult.resolved).toHaveLength(1);
            expect(
              recordsEqual(syncResult.resolved[0].accepted, {
                id: conflictingId,
                title: "task4-local",
                done: false,
              })
            ).eql(true);
          });

          it("should put local database in the expected state", async () => {
            const res = await tasks.list({ order: "title" });
            expect(
              res.data.map((record) => ({
                title: record.title,
                done: record.done,
                _status: record._status,
              }))
            ).toStrictEqual([
              { title: "task1", _status: "synced", done: true },
              { title: "task2", _status: "synced", done: false },
              { title: "task3", _status: "synced", done: true },
              // For CLIENT_WINS strategy, local record is marked as synced
              { title: "task4-local", _status: "synced", done: false },
            ]);
          });

          it("should put remote test server data in the expected state", async () => {
            const list = await getRemoteList();
            expect(list).toStrictEqual([
              // local task4 should have been published to the server.
              { title: "task1", done: true },
              { title: "task2", done: false },
              { title: "task3", done: true },
              { title: "task4-local", done: false },
            ]);
          });

          futureSyncsOK(
            () => tasks,
            () => syncResult
          );
        });

        describe("CLIENT_WINS strategy with transformers", () => {
          beforeEach(async () => {
            syncResult = await collectionTestSync(tasksTransformed, testData, {
              strategy: Kinto.syncStrategy.CLIENT_WINS,
            });
          });

          it("should publish resolved conflict using local version", () => {
            expect(syncResult.published).toHaveLength(1);
            expect(
              recordsEqual(syncResult.published[0], {
                id: conflictingId,
                title: "task4-local",
                done: false,
              })
            ).eql(true);
          });

          it("should not update anything", () => {
            expect(syncResult.updated).toHaveLength(0);
          });

          it("should list resolved records", () => {
            expect(syncResult.resolved).toHaveLength(1);
            expect(
              recordsEqual(syncResult.resolved[0].accepted, {
                id: conflictingId,
                title: "task4-local",
                done: false,
              })
            ).eql(true);
          });

          it("should put local database in the expected state", async () => {
            const res = await tasksTransformed.list({ order: "title" });
            expect(
              res.data.map((record) => ({
                title: record.title,
                done: record.done,
                _status: record._status,
              }))
            ).toStrictEqual([
              { title: "task1", _status: "synced", done: true },
              { title: "task2", _status: "synced", done: false },
              { title: "task3", _status: "synced", done: true },
              // For CLIENT_WINS strategy, local record is marked as synced
              { title: "task4-local", _status: "synced", done: false },
            ]);
          });

          it("should put remote test server data in the expected state", async () => {
            const list = await getRemoteList(tasksTransformed["_name"]);
            expect(list).toStrictEqual([
              // local task4 should have been published to the server.
              { title: "task1", done: true },
              { title: "task2", done: false },
              { title: "task3", done: true },
              { title: "task4-local!", done: false },
            ]);
          });
        });

        describe("SERVER_WINS strategy", () => {
          beforeEach(async () => {
            syncResult = await testSync(testData, {
              strategy: Kinto.syncStrategy.SERVER_WINS,
            });
          });

          it("should have an ok status", () => {
            expect(syncResult.ok).eql(true);
          });

          it("should contain no errors", () => {
            expect(syncResult.errors).toHaveLength(0);
          });

          it("should have a valid lastModified value", () => {
            expect(syncResult.lastModified).to.be.a("number");
          });

          it("should have updated lastModified", async () => {
            expect(tasks.lastModified).toBe(syncResult.lastModified);
            const lastModified = await tasks.db.getLastModified();
            expect(lastModified).toBe(syncResult.lastModified);
          });

          it("should have no incoming conflict listed", () => {
            expect(syncResult.conflicts).toHaveLength(0);
          });

          it("should not skip records", () => {
            expect(syncResult.skipped).toHaveLength(0);
          });

          it("should not import anything", () => {
            expect(syncResult.created).toHaveLength(0);
          });

          it("should not publish resolved conflict using remote version", () => {
            expect(syncResult.published).toHaveLength(0);
          });

          it("should not update anything", () => {
            expect(syncResult.updated).toHaveLength(0);
          });

          it("should list resolved records", () => {
            expect(syncResult.resolved).toHaveLength(1);
            expect(
              recordsEqual(syncResult.resolved[0].accepted, {
                id: conflictingId,
                title: "task4-remote",
                done: true,
              })
            ).eql(true);
          });

          it("should put local database in the expected state", async () => {
            const res = await tasks.list({ order: "title" });
            expect(
              res.data.map((record) => ({
                title: record.title,
                done: record.done,
                _status: record._status,
              }))
            ).toStrictEqual([
              { title: "task1", _status: "synced", done: true },
              { title: "task2", _status: "synced", done: false },
              { title: "task3", _status: "synced", done: true },
              // For SERVER_WINS strategy, remote record is marked as synced
              { title: "task4-remote", _status: "synced", done: true },
            ]);
          });

          it("should put remote test server data in the expected state", async () => {
            const list = await getRemoteList();
            expect(list).toStrictEqual([
              { title: "task1", done: true },
              { title: "task2", done: false },
              { title: "task3", done: true },
              // remote task4 should have been published to the server.
              { title: "task4-remote", done: true },
            ]);
          });

          futureSyncsOK(
            () => tasks,
            () => syncResult
          );
        });

        describe("Resolving conflicts doesn't interfere with sync", () => {
          const conflictingId = uuid4();
          const testData: { [key: string]: KintoIdObject[] } = {
            localSynced: [
              { id: conflictingId, title: "conflicting task", done: false },
            ],
            localUnsynced: [],
            server: [],
          };
          let rawCollection: KintoClientCollection;

          beforeEach(async () => {
            rawCollection = tasks.api.bucket("default").collection("tasks");
            await testSync(testData);
          });

          it("should sync over resolved records", async () => {
            const { data: newRecord } = await tasks.update(
              { id: conflictingId, title: "locally changed title" },
              { patch: true }
            );
            expect(newRecord.last_modified).to.exist;
            await rawCollection.updateRecord(
              { id: conflictingId, title: "remotely changed title" },
              { patch: true }
            );
            const syncResult = await tasks.sync();
            expect(syncResult.ok).eql(false);
            expect(syncResult.conflicts).toHaveLength(1);
            await tasks.resolve(
              syncResult.conflicts[0],
              syncResult.conflicts[0].local
            );
            const syncResult_1 = await tasks.sync();
            expect(syncResult_1.ok).eql(true);
            expect(syncResult_1.conflicts).toHaveLength(0);
            expect(syncResult_1.updated).toHaveLength(0);
            expect(syncResult_1.published).toHaveLength(1);
            const { data: record } = await tasks.get(conflictingId);
            expect(record.title).eql("locally changed title");
            expect(record._status).eql("synced");
          });

          it("should not skip other conflicts", async () => {
            const conflictingId2 = uuid4();
            await tasks.create(
              { id: conflictingId2, title: "second title" },
              { useRecordId: true }
            );
            await tasks.sync();
            await rawCollection.updateRecord(
              { id: conflictingId, title: "remotely changed title" },
              { patch: true }
            );
            await rawCollection.updateRecord(
              { id: conflictingId2, title: "remotely changed title2" },
              { patch: true }
            );
            await tasks.update(
              { id: conflictingId, title: "locally changed title" },
              { patch: true }
            );
            await tasks.update(
              { id: conflictingId2, title: "local title2" },
              { patch: true }
            );
            const syncResult = await tasks.sync();
            expect(syncResult.ok).eql(false);
            expect(syncResult.conflicts).toHaveLength(2);
            await tasks.resolve(
              syncResult.conflicts[1],
              syncResult.conflicts[1].local
            );
            const syncResult_1 = await tasks.sync();
            expect(syncResult_1.ok).eql(false);
            expect(syncResult_1.conflicts).toHaveLength(1);
            expect(syncResult_1.updated).toHaveLength(0);
          });
        });
      });

      describe("Outgoing conflicting local deletion", () => {
        describe("With remote update", () => {
          let id: string, conflicts: any[];

          beforeEach(async () => {
            const { data } = await tasks.create({ title: "initial" });
            id = data.id;
            await tasks.sync();
            await tasks.delete(id);
            await tasks.api
              .bucket("default")
              .collection("tasks")
              .updateRecord({ id, title: "server-updated" });
            const res = await tasks.sync();
            conflicts = res.conflicts;
          });

          it("should properly list the encountered conflict", () => {
            expect(conflicts).toHaveLength(1);
          });

          it("should list the proper type of conflict", () => {
            expect(conflicts[0].type).eql("outgoing");
          });

          it("should have the expected conflicting local version", () => {
            expect(conflicts[0].local).eql({ id });
          });

          it("should have the expected conflicting remote version", () => {
            expect(conflicts[0].remote).toHaveProperty("id", id);
            expect(conflicts[0].remote).toHaveProperty(
              "title",
              "server-updated"
            );
          });
        });

        describe("With remote deletion", () => {
          let id: string, result: SyncResultObject;

          beforeEach(async () => {
            const { data } = await tasks.create({ title: "initial" });
            id = data.id;
            await tasks.sync();
            await tasks.delete(id);
            await tasks.api
              .bucket("default")
              .collection("tasks")
              .deleteRecord(id);
            result = await tasks.sync();
          });

          it("should properly list the encountered conflict", () => {
            expect(result.skipped).toHaveLength(1);
          });

          it("should provide the record", () => {
            expect(result.skipped[0]).toHaveProperty("id", id);
          });
        });
      });

      describe("Outgoing conflict", () => {
        let syncResult: SyncResultObject;

        async function setupConflict(collection: Collection) {
          const record = { title: "task1-remote", done: true };
          // Ensure that the remote record looks like something that's
          // been transformed
          const record_1 = await collection["_encodeRecord"]("remote", record);
          await collection.api
            .bucket("default")
            .collection(collection["_name"])
            .createRecord(record_1 as any);
          const res = await collection.sync();
          const recordId = res.created[0].id;
          await collection.delete(recordId, { virtual: false });
          return await collection.create(
            {
              id: recordId,
              title: "task1-local",
              done: false,
            },
            { useRecordId: true }
          );
        }

        beforeEach(async () => {
          await setupConflict(tasks);
          await setupConflict(tasksTransformed);
        });

        describe("MANUAL strategy (default)", () => {
          let oldLastModified: number;
          beforeEach(async () => {
            oldLastModified = tasks.lastModified!;
            const res = await tasks.sync();
            syncResult = res;
          });

          it("should not have an ok status", () => {
            expect(syncResult.ok).eql(false);
          });

          it("should contain no errors", () => {
            expect(syncResult.errors).toHaveLength(0);
          });

          it("should have a valid lastModified value", () => {
            expect(syncResult.lastModified).to.be.a("number");
          });

          it("should not have updated lastModified", async () => {
            // lastModified hasn't changed because we haven't synced
            // anything since lastModified
            expect(tasks.lastModified).toBe(oldLastModified);
            expect(tasks.lastModified).toBe(syncResult.lastModified);
            const lastModified = await tasks.db.getLastModified();
            expect(lastModified).toBe(syncResult.lastModified);
          });

          it("should have the outgoing conflict listed", () => {
            expect(syncResult.conflicts).toHaveLength(1);
            expect(syncResult.conflicts[0].type).eql("outgoing");
            expect(syncResult.conflicts[0].local.title).eql("task1-local");
            expect(syncResult.conflicts[0].remote.title).eql("task1-remote");
          });

          it("should not skip records", () => {
            expect(syncResult.skipped).toHaveLength(0);
          });

          it("should not import anything", () => {
            expect(syncResult.created).toHaveLength(0);
          });

          it("should not publish anything", () => {
            expect(syncResult.published).toHaveLength(0);
          });

          it("should not update anything", () => {
            expect(syncResult.updated).toHaveLength(0);
          });

          it("should not merge anything", () => {
            expect(syncResult.resolved).toHaveLength(0);
          });

          it("should put local database in the expected state", async () => {
            const list = await tasks.list({ order: "title" });
            expect(
              list.data.map((record) => ({
                title: record.title,
                _status: record._status,
              }))
            ).toStrictEqual([
              // For MANUAL strategy, local conficting record is left intact
              { title: "task1-local", _status: "created" },
            ]);
          });

          it("should put remote test server data in the expected state", async () => {
            const list = await getRemoteList();
            expect(list).toStrictEqual([
              // local version should have been published to the server.
              { title: "task1-remote", done: true },
            ]);
          });

          describe("On next MANUAL sync", () => {
            let nextSyncResult: SyncResultObject;

            beforeEach(async () => {
              nextSyncResult = await tasks.sync();
            });

            it("should not have an ok status", () => {
              expect(nextSyncResult.ok).eql(false);
            });

            it("should contain no errors", () => {
              expect(nextSyncResult.errors).toHaveLength(0);
            });

            it("should not have bumped the lastModified value", () => {
              expect(nextSyncResult.lastModified).eql(syncResult.lastModified);
            });

            it("should preserve unresolved conflicts", () => {
              expect(nextSyncResult.conflicts).toHaveLength(1);
            });

            it("should not skip anything", () => {
              expect(nextSyncResult.skipped).toHaveLength(0);
            });

            it("should not import anything", () => {
              expect(nextSyncResult.created).toHaveLength(0);
            });

            it("should not publish anything", () => {
              expect(nextSyncResult.published).toHaveLength(0);
            });

            it("should not update anything", () => {
              expect(nextSyncResult.updated).toHaveLength(0);
            });
          });
        });

        describe("CLIENT_WINS strategy", () => {
          let oldLastModified: number;
          beforeEach(async () => {
            oldLastModified = tasks.lastModified!;
            const res = await tasks.sync({
              strategy: Kinto.syncStrategy.CLIENT_WINS,
            });
            syncResult = res;
          });

          it("should have an ok status", () => {
            expect(syncResult.ok).eql(true);
          });

          it("should contain no errors", () => {
            expect(syncResult.errors).toHaveLength(0);
          });

          it("should have a valid lastModified value", () => {
            expectTypeOf(syncResult.lastModified).toBeNumber();
          });

          it("should have updated lastModified", async () => {
            // At the end of the sync, we will have pushed our record
            // remotely, which won't have caused a conflict, which
            // will update the remote lastModified, and this is the
            // lastModified our collection will have.
            expect(tasks.lastModified).above(oldLastModified);
            expect(tasks.lastModified).toBe(syncResult.lastModified);
            const lastModified = await tasks.db.getLastModified();
            expect(lastModified).toBe(syncResult.lastModified);
          });

          it("should have the outgoing conflict listed", () => {
            expect(syncResult.conflicts).toHaveLength(0);
          });

          it("should not skip records", () => {
            expect(syncResult.skipped).toHaveLength(0);
          });

          it("should not import anything", () => {
            expect(syncResult.created).toHaveLength(0);
          });

          it("should publish resolved conflicts to the server", () => {
            expect(syncResult.published).toHaveLength(1);
            expect(syncResult.published[0].title).eql("task1-local");
            expect(syncResult.published[0].done).eql(false);
          });

          it("should not update anything", () => {
            expect(syncResult.updated).toHaveLength(0);
          });

          it("should list resolved records", () => {
            expect(syncResult.resolved).toHaveLength(1);
            expect(syncResult.resolved[0].accepted.title).eql("task1-local");
          });

          it("should put local database in the expected state", async () => {
            const res = await tasks.list({ order: "title" });
            expect(
              res.data.map((record) => ({
                title: record.title,
                _status: record._status,
              }))
            ).toStrictEqual([
              // For CLIENT_WINS strategy, local version is marked as synced
              { title: "task1-local", _status: "synced" },
            ]);
          });

          it("should put remote test server data in the expected state", async () => {
            const list = await getRemoteList();
            expect(list).toStrictEqual([{ title: "task1-local", done: false }]);
          });

          futureSyncsOK(
            () => tasks,
            () => syncResult
          );
        });

        describe("CLIENT_WINS strategy with transformers", () => {
          beforeEach(async () => {
            const res = await tasksTransformed.sync({
              strategy: Kinto.syncStrategy.CLIENT_WINS,
            });
            syncResult = res;
          });

          it("should put local database in the expected state", async () => {
            const res = await tasksTransformed.list({ order: "title" });
            expect(
              res.data.map((record) => ({
                title: record.title,
                _status: record._status,
              }))
            ).toStrictEqual([
              // For CLIENT_WINS strategy, local version is marked as synced
              { title: "task1-local", _status: "synced" },
            ]);
          });

          it("should put the remote database in the expected state", async () => {
            const list = await getRemoteList(tasksTransformed["_name"]);
            expect(list).toStrictEqual([
              // local task4 should have been published to the server.
              { title: "task1-local!", done: false },
            ]);
          });
        });

        describe("SERVER_WINS strategy", () => {
          let oldLastModified: number;
          beforeEach(async () => {
            oldLastModified = tasks.lastModified!;
            syncResult = await tasks.sync({
              strategy: Kinto.syncStrategy.SERVER_WINS,
            });
          });

          it("should have an ok status", () => {
            expect(syncResult.ok).eql(true);
          });

          it("should contain no errors", () => {
            expect(syncResult.errors).toHaveLength(0);
          });

          it("should have a valid lastModified value", () => {
            expectTypeOf(syncResult.lastModified).toBeNumber();
          });

          it("should not have updated lastModified", async () => {
            // Although we updated the last modified from the server,
            // the server's lastModified is the same as the one we
            // used to have, since the last modification that took
            // place was when we synced the record (before we forgot
            // about it).
            expect(tasks.lastModified).toBe(oldLastModified);
            expect(tasks.lastModified).toBe(syncResult.lastModified);
            const lastModified = await tasks.db.getLastModified();
            expect(lastModified).toBe(syncResult.lastModified);
          });

          it("should not have the outgoing conflict listed", () => {
            expect(syncResult.conflicts).toHaveLength(0);
          });

          it("should not skip records", () => {
            expect(syncResult.skipped).toHaveLength(0);
          });

          it("should not import anything", () => {
            expect(syncResult.created).toHaveLength(0);
          });

          it("should not publish anything", () => {
            expect(syncResult.published).toHaveLength(0);
          });

          it("should not update anything", () => {
            expect(syncResult.updated).toHaveLength(0);
          });

          it("should list resolved records", () => {
            expect(syncResult.resolved).toHaveLength(1);
            expect(syncResult.resolved[0].accepted.title).eql("task1-remote");
          });

          it("should put local database in the expected state", async () => {
            const res = await tasks.list({ order: "title" });
            expect(
              res.data.map((record) => ({
                title: record.title,
                _status: record._status,
              }))
            ).toStrictEqual([
              // For SERVER_WINS strategy, local version is marked as synced
              { title: "task1-remote", _status: "synced" },
            ]);
          });

          it("should put remote test server data in the expected state", async () => {
            const list = await getRemoteList();
            expect(list).toStrictEqual([{ title: "task1-remote", done: true }]);
          });

          futureSyncsOK(
            () => tasks,
            () => syncResult
          );
        });

        describe("SERVER_WINS strategy with transformers", () => {
          beforeEach(async () => {
            const res = await tasksTransformed.sync({
              strategy: Kinto.syncStrategy.SERVER_WINS,
            });
            syncResult = res;
          });

          it("should not publish anything", () => {
            expect(syncResult.published).toHaveLength(0);
          });

          it("should not update anything", () => {
            expect(syncResult.updated).toHaveLength(0);
          });

          it("should list resolved records", () => {
            expect(syncResult.resolved).toHaveLength(1);
            expect(syncResult.resolved[0].accepted.title).eql("task1-remote");
          });

          it("should put local database in the expected state", async () => {
            const res = await tasksTransformed.list({ order: "title" });
            expect(
              res.data.map((record) => ({
                title: record.title,
                _status: record._status,
              }))
            ).toStrictEqual([
              // For SERVER_WINS strategy, local version is marked as synced
              { title: "task1-remote", _status: "synced" },
            ]);
          });
        });
      });

      describe("Outgoing conflict (remote deleted)", () => {
        let syncResult: SyncResultObject;

        async function setupConflict(collection: Collection) {
          const record = { title: "task1-remote", done: true };
          // Ensure that the remote record looks like something that's
          // been transformed
          const record_1 = await collection["_encodeRecord"]("remote", record);
          await collection.api
            .bucket("default")
            .collection(collection["_name"])
            .createRecord(record_1 as any);
          const res = await collection.sync();
          const recordId = res.created[0].id;
          await collection.api.deleteBucket("default");
          const res_1 = await collection.api
            .bucket("default")
            .collection(collection["_name"])
            .listRecords();
          const lastModified = parseInt(res_1.last_modified!, 10);
          collection["_lastModified"] = lastModified;
          await collection.db.saveLastModified(lastModified);
          return await collection.update({
            id: recordId,
            title: "task1-local",
            done: false,
          });
        }

        beforeEach(async () => {
          await setupConflict(tasks);
          await setupConflict(tasksTransformed);
        });

        describe("MANUAL strategy (default)", () => {
          let oldLastModified: number;

          beforeEach(async () => {
            oldLastModified = tasks.lastModified!;
            const res = await tasks.sync();
            syncResult = res;
          });

          it("should not have an ok status", () => {
            expect(syncResult.ok).eql(false);
          });

          it("should contain no errors", () => {
            expect(syncResult.errors).toHaveLength(0);
          });

          it("should have a valid lastModified value", () => {
            expect(syncResult.lastModified).to.be.a("number");
          });

          it("should not have updated lastModified", async () => {
            // Nothing to update it to; we explicitly copied it from
            // the server before syncing.
            expect(tasks.lastModified).toBe(oldLastModified);
            const lastModified = await tasks.db.getLastModified();
            expect(lastModified).toBe(oldLastModified);
            expect(tasks.lastModified).equal(syncResult.lastModified);
          });

          it("should have the outgoing conflict listed", () => {
            expect(syncResult.conflicts).toHaveLength(1);
            expect(syncResult.conflicts[0].type).eql("outgoing");
            expect(syncResult.conflicts[0].local.title).eql("task1-local");
            expect(syncResult.conflicts[0].remote).eql(null);
          });

          it("should not skip records", () => {
            expect(syncResult.skipped).toHaveLength(0);
          });

          it("should not import anything", () => {
            expect(syncResult.created).toHaveLength(0);
          });

          it("should not publish anything", () => {
            expect(syncResult.published).toHaveLength(0);
          });

          it("should not update anything", () => {
            expect(syncResult.updated).toHaveLength(0);
          });

          it("should not merge anything", () => {
            expect(syncResult.resolved).toHaveLength(0);
          });

          it("should put local database in the expected state", async () => {
            const res = await tasks.list({ order: "title" });
            expect(
              res.data.map((record) => ({
                title: record.title,
                _status: record._status,
              }))
            ).toStrictEqual([
              // For MANUAL strategy, local conficting record is left intact
              { title: "task1-local", _status: "updated" },
            ]);
          });

          it("should put remote test server data in the expected state", async () => {
            const list = await getRemoteList();
            expect(list).toStrictEqual([]);
          });

          describe("On next MANUAL sync", () => {
            let nextSyncResult: SyncResultObject;

            beforeEach(async () => {
              const result = await tasks.sync();
              nextSyncResult = result;
            });

            it("should not have an ok status", () => {
              expect(nextSyncResult.ok).eql(false);
            });

            it("should contain no errors", () => {
              expect(nextSyncResult.errors).toHaveLength(0);
            });

            it("should not have bumped the lastModified value", () => {
              expect(nextSyncResult.lastModified).eql(syncResult.lastModified);
            });

            it("should preserve unresolved conflicts", () => {
              expect(nextSyncResult.conflicts).toHaveLength(1);
            });

            it("should not skip anything", () => {
              expect(nextSyncResult.skipped).toHaveLength(0);
            });

            it("should not import anything", () => {
              expect(nextSyncResult.created).toHaveLength(0);
            });

            it("should not publish anything", () => {
              expect(nextSyncResult.published).toHaveLength(0);
            });

            it("should not update anything", () => {
              expect(nextSyncResult.updated).toHaveLength(0);
            });
          });
        });

        describe("CLIENT_WINS strategy", () => {
          beforeEach(async () => {
            const res = await tasks.sync({
              strategy: Kinto.syncStrategy.CLIENT_WINS,
            });
            syncResult = res;
          });

          it("should have an ok status", () => {
            expect(syncResult.ok).eql(true);
          });

          it("should contain no errors", () => {
            expect(syncResult.errors).toHaveLength(0);
          });

          it("should have a valid lastModified value", () => {
            expect(syncResult.lastModified).to.be.a("number");
          });

          it("should not have the outgoing conflict listed", () => {
            expect(syncResult.conflicts).toHaveLength(0);
          });

          it("should not skip records", () => {
            expect(syncResult.skipped).toHaveLength(0);
          });

          it("should not import anything", () => {
            expect(syncResult.created).toHaveLength(0);
          });

          it("should publish resolved conflicts to the server", () => {
            expect(syncResult.published).toHaveLength(1);
            expect(syncResult.published[0].title).eql("task1-local");
            expect(syncResult.published[0].done).eql(false);
          });

          it("should not update anything", () => {
            expect(syncResult.updated).toHaveLength(0);
          });

          it("should list resolved records", () => {
            expect(syncResult.resolved).toHaveLength(1);
            expect(syncResult.resolved[0].rejected).eql(null);
            expect(syncResult.resolved[0].id).eql(
              syncResult.resolved[0].accepted.id
            );
            expect(syncResult.resolved[0].accepted.title).eql("task1-local");
          });

          it("should put local database in the expected state", async () => {
            const res = await tasks.list({ order: "title" });
            expect(
              res.data.map((record) => ({
                title: record.title,
                _status: record._status,
              }))
            ).toStrictEqual([
              // For CLIENT_WINS strategy, local version is marked as synced
              { title: "task1-local", _status: "synced" },
            ]);
          });

          it("should put remote test server data in the expected state", async () => {
            const list = await getRemoteList();
            expect(list).toStrictEqual([{ title: "task1-local", done: false }]);
          });

          futureSyncsOK(
            () => tasks,
            () => syncResult
          );
        });

        describe("CLIENT_WINS strategy with transformers", () => {
          beforeEach(async () => {
            const res = await tasksTransformed.sync({
              strategy: Kinto.syncStrategy.CLIENT_WINS,
            });
            syncResult = res;
          });

          it("should put local database in the expected state", async () => {
            const res = await tasksTransformed.list({ order: "title" });
            expect(
              res.data.map((record) => ({
                title: record.title,
                _status: record._status,
              }))
            ).toStrictEqual([
              // For CLIENT_WINS strategy, local version is marked as synced
              { title: "task1-local", _status: "synced" },
            ]);
          });

          it("should put the remote database in the expected state", async () => {
            const list = await getRemoteList(tasksTransformed["_name"]);
            expect(list).toStrictEqual([
              // local task4 should have been published to the server.
              { title: "task1-local!", done: false },
            ]);
          });
        });

        describe("SERVER_WINS strategy", () => {
          beforeEach(async () => {
            const res = await tasks.sync({
              strategy: Kinto.syncStrategy.SERVER_WINS,
            });
            syncResult = res;
          });

          it("should have an ok status", () => {
            expect(syncResult.ok).eql(true);
          });

          it("should contain no errors", () => {
            expect(syncResult.errors).toHaveLength(0);
          });

          it("should have a valid lastModified value", () => {
            expect(syncResult.lastModified).to.be.a("number");
          });

          it("should have the outgoing conflict listed", () => {
            expect(syncResult.conflicts).toHaveLength(0);
          });

          it("should not skip records", () => {
            expect(syncResult.skipped).toHaveLength(0);
          });

          it("should not import anything", () => {
            expect(syncResult.created).toHaveLength(0);
          });

          it("should not publish anything", () => {
            expect(syncResult.published).toHaveLength(0);
          });

          it("should not update anything", () => {
            expect(syncResult.updated).toHaveLength(0);
          });

          it("should list resolved records", () => {
            expect(syncResult.resolved).toHaveLength(1);
            expect(syncResult.resolved[0].accepted).eql(null);
            expect(syncResult.resolved[0]).property("_status", "synced");
            expect(syncResult.resolved[0].rejected.title).eql("task1-local");
          });

          it("should put local database in the expected state", async () => {
            const { data: d } = await tasks.list({ order: "title" });
            expect(d).toStrictEqual([]);
          });

          it("should put remote test server data in the expected state", async () => {
            const list = await getRemoteList();
            expect(list).toStrictEqual([]);
          });

          futureSyncsOK(
            () => tasks,
            () => syncResult
          );
        });

        describe("SERVER_WINS strategy with transformers", () => {
          beforeEach(async () => {
            const res = await tasksTransformed.sync({
              strategy: Kinto.syncStrategy.SERVER_WINS,
            });
            syncResult = res;
          });

          it("should not publish anything", () => {
            expect(syncResult.published).toHaveLength(0);
          });

          it("should not update anything", () => {
            expect(syncResult.updated).toHaveLength(0);
          });

          it("should list resolved records", () => {
            expect(syncResult.resolved).toHaveLength(1);
            expect(syncResult.resolved[0].id).eql(
              syncResult.resolved[0].rejected.id
            );
            expect(syncResult.resolved[0].rejected.title).eql("task1-local");
          });

          it("should put local database in the expected state", async () => {
            const { data: d } = await tasksTransformed.list({ order: "title" });
            expect(d).toStrictEqual([]);
          });
        });
      });

      describe("Load dump", () => {
        beforeEach(async () => {
          const id1 = uuid4();
          const id2 = uuid4();
          const tasksRemote = tasks.api.bucket("default").collection("tasks");
          const dump = [
            { id: uuid4(), last_modified: 123456, title: "task1", done: false },
            { id: id1, last_modified: 123457, title: "task2", done: false },
            { id: id2, last_modified: 123458, title: "task3", done: false },
            { id: uuid4(), last_modified: 123459, title: "task4", done: false },
          ];
          await Promise.all(dump.map((r) => tasksRemote.createRecord(r)));
          await tasks.importBulk(dump);
          await tasksRemote.updateRecord({
            id: id1,
            title: "task22",
            done: true,
          });
          await tasksRemote.updateRecord({
            id: id2,
            title: "task33",
            done: true,
          });
        });

        it("should sync changes on loaded data", async () => {
          const res = await tasks.sync();
          expect(res.ok).eql(true);
          expect(res.updated.length).eql(2);
        });
      });

      describe("Batch request chunking", () => {
        let nbFixtures: number;

        async function loadFixtures() {
          const serverSettings = await tasks.api.fetchServerSettings();
          nbFixtures = serverSettings["batch_max_requests"] + 10;
          const fixtures = [];
          for (let i = 0; i < nbFixtures; i++) {
            fixtures.push({ title: "title" + i, position: i });
          }
          return Promise.all(fixtures.map((f) => tasks.create(f)));
        }

        beforeEach(async () => {
          await loadFixtures();
          await tasks.sync();
        });

        it("should create the expected number of records", async () => {
          const res = await tasks.list({ order: "-position" });
          expect(res.data.length).eql(nbFixtures);
          expect(res.data[0].position).eql(nbFixtures - 1);
        });
      });
    });

    describe("Schemas", () => {
      function createIntegerIdSchema(): IdSchema {
        let _next = 0;
        return {
          generate() {
            const id = _next;
            _next++;
            return id.toString();
          },
          validate(id) {
            const parsedId = parseInt(id, 10);
            return +id === +id && parsedId >= 0;
          },
        };
      }

      describe("IdSchema", () => {
        beforeEach(() => {
          tasks = kinto.collection("tasks", {
            idSchema: createIntegerIdSchema(),
          });
        });

        it("should generate id's using the IdSchema", async () => {
          const record = await tasks.create({ foo: "bar" });
          expect(record.data.id).toBe("0");
        });
      });
    });

    describe("Transformers", () => {
      function createTransformer(char: string) {
        return {
          encode(record: any) {
            return { ...record, title: record.title + char };
          },
          decode(record: any) {
            return { ...record, title: record.title.slice(0, -1) };
          },
        };
      }

      beforeEach(async () => {
        tasks = kinto.collection("tasks", {
          remoteTransformers: [createTransformer("!"), createTransformer("?")],
        });

        await Promise.all([
          tasks.create({ id: uuid4(), title: "abc" }, { useRecordId: true }),
          tasks.create({ id: uuid4(), title: "def" }, { useRecordId: true }),
        ]);
      });

      it("should list published records unencoded", async () => {
        const res = await tasks.sync();
        expect(res.published.map((x: any) => x.title).sort()).toStrictEqual([
          "abc",
          "def",
        ]);
      });

      it("should store encoded data remotely", async () => {
        await tasks.sync();

        const res = await fetch(
          `${TEST_KINTO_SERVER}/buckets/default/collections/tasks/records`,
          {
            headers: { Authorization: "Basic " + btoa("user:pass") },
          }
        );
        const { data } = await res.json();
        expect(data.map((x: any) => x.title).sort()).toStrictEqual([
          "abc!?",
          "def!?",
        ]);
      });

      it("should keep local data decoded", async () => {
        await tasks.sync();
        const res = await tasks.list();
        expect(res.data.map((x: any) => x.title).sort()).toStrictEqual([
          "abc",
          "def",
        ]);
      });
    });

    describe("Transforming local deletes", () => {
      function localDeleteTransformer() {
        // Turns local records that were deleted, but had
        // "preserve-on-send", into remote "updates".
        // Local records with "preserve-on-send" but weren't deleted
        // don't need to be "preserved", so ignore them.
        return {
          encode(record: any) {
            if (record._status === "deleted") {
              if (record.title.includes("preserve-on-send")) {
                if (record.last_modified) {
                  return { ...record, _status: "updated", wasDeleted: true };
                }
                return { ...record, _status: "created", wasDeleted: true };
              }
            }
            return record;
          },
          decode(record: any) {
            // Records that were deleted locally get pushed to the
            // server with `wasDeleted` so that we know they're
            // supposed to be deleted on the client.
            if (record.wasDeleted) {
              return { ...record, deleted: true };
            }
            return record;
          },
        };
      }

      let tasksRemote: KintoClientCollection;
      const preserveOnSendNew = { id: uuid4(), title: "preserve-on-send new" };
      const preserveOnSendOld = {
        id: uuid4(),
        title: "preserve-on-send old",
        last_modified: 1234,
      };
      const deleteOnReceiveRemote = {
        id: uuid4(),
        title: "delete-on-receive",
        wasDeleted: true,
      };
      const deletedByOtherClientRemote = {
        id: uuid4(),
        title: "deleted-by-other-client",
      };
      beforeEach(async () => {
        tasks = kinto.collection("tasks", {
          remoteTransformers: [localDeleteTransformer()],
        });
        tasksRemote = tasks.api.bucket("default").collection("tasks");
        await Promise.all([
          tasks.create(preserveOnSendNew, { useRecordId: true }),
          tasks.create(preserveOnSendOld, { useRecordId: true }),
          tasksRemote.createRecord(deletedByOtherClientRemote),
        ]);
        await tasks.sync();
        await tasks.delete(preserveOnSendNew.id);
        await tasks.delete(preserveOnSendOld.id);
        await tasksRemote.createRecord(deleteOnReceiveRemote);
      });

      it("should have sent preserve-on-send new remotely", async () => {
        await tasks.sync();
        const { data } = await tasksRemote.getRecord(preserveOnSendNew.id);
        expect(data).toHaveProperty("title", "preserve-on-send new");
      });

      it("should have sent preserve-on-send old remotely", async () => {
        await tasks.sync();
        const { data } = await tasksRemote.getRecord(preserveOnSendOld.id);
        expect(data).toHaveProperty("title", "preserve-on-send old");
      });

      it("should have locally deleted preserve-on-send new", async () => {
        await tasks.sync();
        const { data } = await tasks.getAny(preserveOnSendNew.id);
        expect(data).toBeUndefined();
      });

      it("should have locally deleted preserve-on-send old", async () => {
        await tasks.sync();
        const { data } = await tasks.getAny(preserveOnSendOld.id);
        expect(data).toBeUndefined();
      });

      it("should have deleted delete-on-receive", async () => {
        await tasks.sync();
        const { data } = await tasks.getAny(deleteOnReceiveRemote.id);
        expect(data).toBeUndefined();
      });

      it("should have deleted deleted-by-other-client", async () => {
        const res = await tasks.getAny(deletedByOtherClientRemote.id);
        expect(res.data.title).eql("deleted-by-other-client");
        await tasksRemote.createRecord({
          ...deletedByOtherClientRemote,
          wasDeleted: true,
        });
        await tasks.sync();
        const res_1 = await tasks.getAny(deletedByOtherClientRemote.id);
        expect(res_1.data).toBeUndefined();
      });
    });
  });

  describe("Flushed server", function () {
    beforeAll(async () => {
      await server.start({});
    });

    afterAll(async () => {
      await server.stop();
    });

    beforeEach(async () => {
      await tasks.clear();
      await Promise.all([
        tasks.create({ name: "foo" }),
        tasks.create({ name: "bar" }),
      ]);
      await tasks.sync();
      await server.flush();
    });

    it("should reject a call to sync() with appropriate message", async () => {
      await expectAsyncError(
        () => tasks.sync(),
        /^Server has been flushed. Client Side Timestamp: \d+ Server Side Timestamp: \d+$/,
        ServerWasFlushedError
      );
    });

    it("should allow republishing local collection to flushed server", async () => {
      try {
        await tasks.sync();
      } catch (e) {
        await tasks.resetSyncStatus();
      }

      const res = await tasks.sync();
      expect(res.published).toHaveLength(2);
    });
  });

  describe("Backed off server", () => {
    beforeAll(async () => {
      await server.start({ KINTO_BACKOFF: "10" });
    });

    afterAll(async () => {
      await server.stop();
    });

    beforeEach(async () => {
      await tasks.clear();
      await server.flush();
    });

    it("should reject sync when the server sends a Backoff header", async () => {
      // Note: first call receive the Backoff header, second actually rejects.
      await expectAsyncError(async () => {
        await tasks.sync();
        await tasks.sync();
      }, /Server is asking clients to back off; retry in 10s/);
    });
  });

  describe("Deprecated protocol version", () => {
    beforeEach(async () => {
      await tasks.clear();
      await server.flush();
    });

    describe("Soft EOL", () => {
      let consoleWarnStub: Mock;

      beforeAll(async () => {
        const tomorrow = new Date(new Date().getTime() + 86400000)
          .toJSON()
          .slice(0, 10);
        await server.start({
          KINTO_EOS: `"${tomorrow}"`,
          KINTO_EOS_URL: "http://www.perdu.com",
          KINTO_EOS_MESSAGE: "Boom",
        });
      });

      afterAll(async () => {
        await server.stop();
      });

      beforeEach(() => {
        consoleWarnStub = vitest.spyOn(console, "warn");
      });

      it("should warn when the server sends a deprecation Alert header", async () => {
        await tasks.sync();
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
        await server.start({
          KINTO_EOS: `"${lastWeek}"`,
          KINTO_EOS_URL: "http://www.perdu.com",
          KINTO_EOS_MESSAGE: "Boom",
        });
      });

      afterAll(async () => {
        await server.stop();
      });

      beforeEach(() => {
        vitest.spyOn(console, "warn");
      });

      it("should reject with a 410 Gone when hard EOL is received", async () => {
        // As of Kinto 13.6.2, EOL responses don't contain CORS headers, so we
        // can only assert than an error is throw.
        await expectAsyncError(
          () => tasks.sync(),
          /HTTP 410 Gone: Service deprecated/
          // ServerResponse
        );
      });
    });
  });
});
