import * as requests from "../../src/http/requests";
import {
  aggregate,
  AggregateResponse,
  KintoBatchResponse,
} from "../../src/http/batch";
import { KintoRequest } from "../../src/types";
import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";

describe("batch module", () => {
  describe("aggregate()", () => {
    it("should throw if responses length doesn't match requests one", () => {
      const resp = {
        status: 200,
        path: "/sample",
        body: { data: {} },
        headers: {},
      };
      const req = requests.createRequest("foo1", {
        data: { id: 1 },
      });
      expect(() => aggregate([resp], [req, req])).toThrow(/match/);
    });

    it("should return an object", () => {
      expectTypeOf(aggregate([], [])).toBeObject();
    });

    it("should return an object with the expected keys", () => {
      expect(aggregate([], [])).toMatchObject({
        published: [],
        conflicts: [],
        skipped: [],
        errors: [],
      });
    });

    it("should expose HTTP 500 errors in the errors list", () => {
      const _requests = [
        requests.createRequest("foo1", {
          data: { id: 1 },
        }),
        requests.createRequest("foo2", { data: { id: 2 } }),
      ];
      const responses = [
        { status: 500, body: { data: { err: 1 } }, path: "/foo1", headers: {} },
        { status: 503, body: { data: { err: 2 } }, path: "/foo2", headers: {} },
      ];

      expect(aggregate(responses, _requests)).toHaveProperty("errors", [
        {
          error: { data: { err: 1 } },
          path: "foo1",
          sent: _requests[0],
        },
        {
          error: { data: { err: 2 } },
          path: "foo2",
          sent: _requests[1],
        },
      ]);
    });

    it("should expose HTTP 200<=x<400 responses in the published list", () => {
      const _requests = [
        requests.createRequest("foo", {
          data: { id: 1 },
        }),
        requests.createRequest("foo", { data: { id: 2 } }),
      ];
      const responses = [
        { status: 200, body: { data: { id: 1 } }, path: "/foo", headers: {} },
        { status: 201, body: { data: { id: 2 } }, path: "/foo", headers: {} },
      ];

      expect(aggregate(responses, _requests)).toHaveProperty(
        "published",
        responses.map((r) => r.body)
      );
    });

    it("should expose HTTP 404 responses in the skipped list", () => {
      const _requests = [
        requests.createRequest("records/123", {
          data: { id: 1 },
        }),
        requests.createRequest("records/123", { data: { id: 2 } }),
      ];
      const responses = [
        {
          status: 404,
          body: { errno: 110, code: 404, error: "Not found" },
          path: "records/123",
          headers: {},
        },
        {
          status: 404,
          body: { errno: 110, code: 404, error: "Not found" },
          path: "records/123",
          headers: {},
        },
      ];

      expect(aggregate(responses, _requests)).toHaveProperty(
        "skipped",
        responses.map((r) => ({
          id: "123",
          path: "records/123",
          error: r.body,
        }))
      );
    });

    it("should expose HTTP 412 responses in the conflicts list", () => {
      const _requests = [
        requests.createRequest("records/123", {
          data: { id: 1 },
        }),
        requests.createRequest("records/123", { data: { id: 2 } }),
      ];
      const responses = [
        {
          status: 412,
          body: { details: { existing: { last_modified: 0, id: "1" } } },
          path: "records/123",
          headers: {},
        },
        { status: 412, body: {}, path: "records/123", headers: {} },
      ];

      expect(aggregate(responses, _requests)).toHaveProperty("conflicts", [
        {
          type: "outgoing",
          local: _requests[0].body,
          remote: { last_modified: 0, id: "1" },
        },
        {
          type: "outgoing",
          local: _requests[1].body,
          remote: null,
        },
      ]);
    });

    describe("Heterogeneous combinations", () => {
      let _requests: KintoRequest[],
        responses: KintoBatchResponse[],
        results: AggregateResponse;

      beforeEach(() => {
        _requests = [
          requests.createRequest("collections/abc/records/123", {
            data: { id: 1 },
          }),
          requests.createRequest("collections/abc/records/123", {
            data: { id: 2 },
          }),
          requests.createRequest("collections/abc/records/123", {
            data: { id: 3 },
          }),
          requests.createRequest("collections/abc/records/123", {
            data: { id: 4, a: 1 },
          }),
        ];
        responses = [
          { status: 500, path: "path1", body: { errno: 1 }, headers: {} },
          {
            status: 200,
            body: { data: { foo: "bar" } },
            path: "/",
            headers: {},
          },
          {
            status: 404,
            body: { errno: 110, code: 404, error: "Not found" },
            path: "/",
            headers: {},
          },
          {
            status: 412,
            body: { details: { existing: { last_modified: 1, id: "1" } } },
            path: "/",
            headers: {},
          },
        ];

        results = aggregate(responses, _requests);
      });

      it("should list errors", () => {
        expect(results.errors).eql([
          {
            error: { errno: 1 },
            path: "collections/abc/records/123",
            sent: _requests[0],
          },
        ]);
      });

      it("should list published data", () => {
        expect(results.published).eql([{ data: { foo: "bar" } }]);
      });

      it("should list conflicts", () => {
        expect(results.conflicts).eql([
          {
            type: "outgoing",
            local: {
              data: { id: 4, a: 1 },
              permissions: undefined,
            },
            remote: { last_modified: 1, id: "1" },
          },
        ]);
      });

      it("should list skips", () => {
        expect(results.skipped).eql([
          {
            id: "123",
            path: "collections/abc/records/123",
            error: responses[2].body,
          },
        ]);
      });
    });
  });
});
