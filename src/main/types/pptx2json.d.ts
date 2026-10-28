declare module 'pptx2json' {
  export default class PPTX2Json {
    toJson(file: string): Promise<Record<string, unknown>>
    buffer2json(buffer: Buffer | ArrayBuffer | Uint8Array): Promise<Record<string, unknown>>
  }
}
