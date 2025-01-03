import mitt from "mitt";
import { fakeServerResponse, expectAsyncError } from "../test_utils";
import HTTP from "../../src/http/http";
import {
  NetworkTimeoutError,
  ServerResponse,
  UnparseableResponseError,
} from "../../src/http/errors";
import { Emitter } from "../../src/types";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  Mock,
  vitest,
} from "vitest";

/** @test {HTTP} */
describe("HTTP class", () => {
  function runSuite(label: string, emitter?: () => Emitter) {
    describe(label, () => {
      let events: Emitter | undefined, http: HTTP;

      beforeEach(() => {
        events = emitter ? emitter() : undefined;
        http = new HTTP(events, { timeout: 100 });
      });

      afterEach(() => {
        vitest.restoreAllMocks();
      });

      /** @test {HTTP#constructor} */
      describe("#constructor", () => {
        it("should expose a passed events instance", () => {
          if (emitter) {
            const events = emitter();
            const http = new HTTP(events);
            expect(http.events).toStrictEqual(events);
          }
        });

        it("should accept a requestMode option", () => {
          expect(
            new HTTP(events, {
              requestMode: "no-cors",
            }).requestMode
          ).toBe("no-cors");
        });

        it("should not complain if an events handler is not provided", () => {
          expect(() => {
            new HTTP();
          }).not.to.Throw(Error, /No events handler provided/);
        });
      });

      /** @test {HTTP#request} */
      describe("#request()", () => {
        describe("Request headers", () => {
          let fetchStub: Mock;
          beforeEach(() => {
            fetchStub = vitest
              .spyOn(http as any, "fetchFunc")
              .mockReturnValue(fakeServerResponse(200, {}, {}));
          });

          it("should set default headers", () => {
            http.request("/");

            expect(fetchStub.mock.calls[0][1].headers).toStrictEqual(
              HTTP.DEFAULT_REQUEST_HEADERS
            );
          });

          it("should merge custom headers with default ones", () => {
            http.request("/", { headers: { Foo: "Bar" } });

            expect(fetchStub.mock.calls[0][1].headers.Foo).toBe("Bar");
          });

          it("should drop custom content-type header for multipart body", () => {
            http.request("/", {
              headers: { "Content-Type": "application/foo" },
              body: new FormData(),
            });

            expect(fetchStub.mock.calls[0][1].headers["Content-Type"]).to.be
              .undefined;
          });
        });

        describe("Request CORS mode", () => {
          let fetchStub: Mock;

          it("should use default CORS mode", () => {
            const http = new HTTP(events);
            fetchStub = vitest
              .spyOn(http as any, "fetchFunc")
              .mockReturnValue(fakeServerResponse(200, {}, {}));

            http.request("/");

            expect(fetchStub.mock.calls[0][1].mode).toBe("cors");
          });

          it("should use configured custom CORS mode", () => {
            const http = new HTTP(events, { requestMode: "no-cors" });
            fetchStub = vitest
              .spyOn(http as any, "fetchFunc")
              .mockReturnValue(fakeServerResponse(200, {}, {}));

            http.request("/");

            expect(fetchStub.mock.calls[0][1].mode).toBe("no-cors");
          });
        });

        describe("Succesful request", () => {
          beforeEach(() => {
            vitest
              .spyOn(http as any, "fetchFunc")
              .mockReturnValue(fakeServerResponse(200, { a: 1 }, { b: 2 }));
          });

          it("should resolve with HTTP status", async () => {
            const { status } = await http.request("/");
            expect(status).toBe(200);
          });

          it("should resolve with JSON body", async () => {
            const { json } = await http.request("/");
            expect(json as { a: number }).toStrictEqual({ a: 1 });
          });

          it("should resolve with headers", async () => {
            const { headers } = await http.request("/");
            expect(headers.get("b")).toStrictEqual("2");
          });
        });

        describe("Request timeout", () => {
          beforeEach(() => {
            vitest.spyOn(http as any, "fetchFunc").mockReturnValue(
              new Promise((resolve) => {
                setTimeout(resolve, 20000);
              })
            );
          });

          it("should timeout the request", async () => {
            await expectAsyncError(
              () => http.request("/"),
              undefined,
              NetworkTimeoutError
            );
          });

          it("should show request properties in error", async () => {
            await expectAsyncError(
              () =>
                http.request("/", {
                  mode: "cors",
                  headers: {
                    Authorization: "XXX",
                    "User-agent": "mocha-test",
                  },
                }),
              'Timeout while trying to access / with {"mode":"cors","headers":{"accept":"application/json","authorization":"**** (suppressed)","content-type":"application/json","user-agent":"mocha-test"}}'
            );
          });
        });

        describe("No content response", () => {
          it("should resolve with null JSON if Content-Length header is missing", async () => {
            vitest
              .spyOn(http as any, "fetchFunc")
              .mockReturnValue(fakeServerResponse(200, null, {}));

            const { json } = await http.request("/");
            expect(json).toBeNull();
          });
        });

        describe("Malformed JSON response", () => {
          it("should reject with an appropriate message", async () => {
            vitest.spyOn(http as any, "fetchFunc").mockResolvedValue({
              status: 200,
              headers: {
                get(name: string) {
                  if (name !== "Alert") {
                    return "fake";
                  }
                  return "";
                },
              },
              text() {
                return Promise.resolve("an example of invalid JSON");
              },
            });

            await expectAsyncError(
              () => http.request("/"),
              /Response from server unparseable/,
              UnparseableResponseError
            );
          });
        });

        describe("Business error responses", () => {
          it("should reject on status code > 400", async () => {
            vitest.spyOn(http as any, "fetchFunc").mockResolvedValue(
              fakeServerResponse(400, {
                code: 400,
                details: [
                  {
                    description: "data is missing",
                    location: "body",
                    name: "data",
                  },
                ],
                errno: 107,
                error: "Invalid parameters",
                message: "data is missing",
              })
            );

            await expectAsyncError(
              () => http.request("/"),
              /HTTP 400 Invalid parameters: Invalid request parameter \(data is missing\)/,
              ServerResponse
            );
          });

          it("should expose JSON error bodies", async () => {
            const errorBody = {
              code: 400,
              details: [
                {
                  description: "data is missing",
                  location: "body",
                  name: "data",
                },
              ],
              errno: 107,
              error: "Invalid parameters",
              message: "data is missing",
            };
            vitest
              .spyOn(http as any, "fetchFunc")
              .mockReturnValue(fakeServerResponse(400, errorBody));

            const error = await expectAsyncError(
              () => http.request("/"),
              undefined,
              ServerResponse
            );
            expect(error).toHaveProperty("data", errorBody);
          });

          it("should reject on status code > 400 even with empty body", async () => {
            vitest.spyOn(http as any, "fetchFunc").mockResolvedValue({
              status: 400,
              statusText: "Cake Is A Lie",
              headers: {
                get(name: string) {
                  if (name === "Content-Length") {
                    return 0;
                  }
                  return "";
                },
              },
              text() {
                return Promise.resolve("");
              },
            });

            await expectAsyncError(
              () => http.request("/"),
              /HTTP 400 Cake Is A Lie$/,
              ServerResponse
            );
          });
        });

        describe("Deprecation header", () => {
          const eolObject = {
            code: "soft-eol",
            url: "http://eos-url",
            message: "This service will soon be decommissioned",
          };

          let consoleWarnStub: Mock;
          let eventsEmitStub: Mock;

          beforeEach(() => {
            consoleWarnStub = vitest.spyOn(console, "warn");
            eventsEmitStub = events ? vitest.spyOn(events, "emit") : null;
          });

          it("should handle deprecation header", async () => {
            vitest
              .spyOn(http as any, "fetchFunc")
              .mockReturnValue(
                fakeServerResponse(
                  200,
                  {},
                  { Alert: JSON.stringify(eolObject) }
                )
              );

            await http.request("/");
            expect(consoleWarnStub).toHaveBeenCalledOnce();
            expect(consoleWarnStub).toHaveBeenCalledWith(
              eolObject.message,
              eolObject.url
            );
          });

          it("should handle deprecation header parse error", async () => {
            vitest
              .spyOn(http as any, "fetchFunc")
              .mockReturnValue(fakeServerResponse(200, {}, { Alert: "dafuq" }));

            await http.request("/");
            expect(consoleWarnStub).toHaveBeenCalledOnce();
            expect(consoleWarnStub).toHaveBeenCalledWith(
              "Unable to parse Alert header message",
              "dafuq"
            );
          });

          it("should emit a deprecated event on Alert header", async () => {
            vitest
              .spyOn(http as any, "fetchFunc")
              .mockReturnValue(
                fakeServerResponse(
                  200,
                  {},
                  { Alert: JSON.stringify(eolObject) }
                )
              );

            await http.request("/");
            if (events && eventsEmitStub) {
              expect(eventsEmitStub.mock.calls[0][0]).toBe("deprecated");
              expect(eventsEmitStub.mock.calls[0][1]).toStrictEqual(eolObject);
            }
          });
        });

        describe("Backoff header handling", () => {
          let eventsEmitStub: Mock;
          beforeEach(() => {
            // Make Date#getTime always returning 1000000, for predictability
            vitest
              .spyOn(Date.prototype, "getTime")
              .mockReturnValue(1000 * 1000);
            eventsEmitStub = events ? vitest.spyOn(events, "emit") : null;
          });

          it("should emit a backoff event on set Backoff header", async () => {
            vitest
              .spyOn(http as any, "fetchFunc")
              .mockReturnValue(
                fakeServerResponse(200, {}, { Backoff: "1000" })
              );

            await http.request("/");
            if (events && eventsEmitStub) {
              expect(eventsEmitStub.mock.calls[0][0]).toBe("backoff");
              expect(eventsEmitStub.mock.calls[0][1]).toBe(2000000);
            }
          });

          it("should emit a backoff event even on error responses", async () => {
            vitest
              .spyOn(http as any, "fetchFunc")
              .mockReturnValue(
                fakeServerResponse(503, {}, { Backoff: "1000" })
              );

            try {
              await http.request("/");
            } catch (err) {}
            if (events && eventsEmitStub) {
              expect(eventsEmitStub.mock.calls[0][0]).toBe("backoff");
              expect(eventsEmitStub.mock.calls[0][1]).toBe(2000000);
            }
          });

          it("should emit a backoff event on missing Backoff header", async () => {
            vitest
              .spyOn(http as any, "fetchFunc")
              .mockReturnValue(fakeServerResponse(200, {}, {}));

            await http.request("/");
            if (events && eventsEmitStub) {
              expect(eventsEmitStub.mock.calls[0][0]).toBe("backoff");
              expect(eventsEmitStub.mock.calls[0][1]).toBe(0);
            }
          });
        });

        describe("Retry-After header handling", () => {
          let eventsEmitStub: Mock;
          describe("Event", () => {
            beforeEach(() => {
              // Make Date#getTime always returning 1000000, for predictability
              vitest
                .spyOn(Date.prototype, "getTime")
                .mockReturnValue(1000 * 1000);
              eventsEmitStub = events ? vitest.spyOn(events, "emit") : null;
            });

            it("should emit a retry-after event when Retry-After is set", async () => {
              vitest
                .spyOn(http as any, "fetchFunc")
                .mockReturnValue(
                  fakeServerResponse(200, {}, { "Retry-After": "1000" })
                );

              await http.request("/", {}, { retry: 0 });
              if (events && eventsEmitStub) {
                expect(eventsEmitStub.mock.lastCall[0]).toBe("retry-after");
                expect(eventsEmitStub.mock.lastCall[1]).toBe(2000000);
              }
            });
          });

          describe("Retry loop", () => {
            let fetch: Mock;

            beforeEach(() => {
              fetch = vitest.spyOn(http as any, "fetchFunc");
            });

            it("should not retry the request by default", async () => {
              fetch.mockResolvedValue(
                fakeServerResponse(503, {}, { "Retry-After": "1" })
              );

              await expectAsyncError(() => http.request("/"), /HTTP 503/);
            });

            it("should retry the request if specified", async () => {
              const success = { success: true };
              fetch.mockResolvedValueOnce(
                fakeServerResponse(503, {}, { "Retry-After": "1" })
              );
              fetch.mockResolvedValueOnce(fakeServerResponse(200, success));

              const { json } = await http.request("/", {}, { retry: 1 });
              expect(json as { success: boolean }).toStrictEqual(success);
            });

            it("should error when retries are exhausted", async () => {
              fetch.mockResolvedValueOnce(
                fakeServerResponse(503, {}, { "Retry-After": "1" })
              );
              fetch.mockResolvedValueOnce(
                fakeServerResponse(503, {}, { "Retry-After": "1" })
              );
              fetch.mockResolvedValueOnce(
                fakeServerResponse(503, {}, { "Retry-After": "1" })
              );

              await expectAsyncError(
                () => http.request("/", {}, { retry: 2 }),
                /HTTP 503/
              );
            });
          });
        });
      });
    });
  }

  if (typeof window == "undefined") {
    // don't run in browser
    const { EventEmitter } = require("events");
    runSuite("with EventEmitter", () => new EventEmitter());
  }

  runSuite("with mitt", () => mitt());
  runSuite("without EventEmitter");
});
