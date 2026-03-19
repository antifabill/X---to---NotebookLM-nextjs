declare module "adm-zip" {
  export default class AdmZip {
    addFile(entryName: string, content: Buffer): void;
    deleteFile(entryName: string): void;
    writeZip(targetFileName: string): void;
  }
}
