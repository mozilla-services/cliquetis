export function updateTitleWithDelay(record: any, str: string, delay: number) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ ...record, title: record.title + str });
    }, delay);
  });
}

export async function expectAsyncError<T>(
  fn: () => Promise<T>,
  message?: string | RegExp,
  baseClass: any = Error
): Promise<Error> {
  let error: Error;

  try {
    await fn();
  } catch (err: any) {
    error = err;
  }

  expect(error!).toBeDefined();
  expect(error!).toBeInstanceOf(baseClass);
  if (message) {
    if (typeof message === "string") {
      expect(error).toHaveProperty("message", message);
    } else {
      expect(error).toHaveProperty("message", expect.stringMatching(message));
    }
  }

  return error!;
}

export function fakeHeaders(headers: { [key: string]: string | number } = {}) {
  const h = new Headers();
  Object.entries(headers).forEach(([k, v]) => h.set(k, v.toString()));
  return h;
}

export function fakeServerResponse(
  status: number,
  json: any,
  headers: { [key: string]: string | number } = {}
) {
  const respHeaders = fakeHeaders(headers);
  if (!respHeaders.has("Content-Length")) {
    respHeaders.set("Content-Length", JSON.stringify(json).length.toString());
  }
  return Promise.resolve({
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: respHeaders,
    text() {
      return Promise.resolve(JSON.stringify(json));
    },
  });
}

export function delayedPromise(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

export function btoa(str: string): string {
  if (globalThis.btoa) {
    return globalThis.btoa(str);
  }

  return Buffer.from(str, "binary").toString("base64");
}

export function fakeBlob(
  dataArray: WithImplicitCoercion<ArrayBuffer | SharedArrayBuffer>[]
) {
  return Buffer.from(dataArray[0]);
}
