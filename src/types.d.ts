declare module "*.css";
declare module "*.png" {
  const src: string;
  export default src;
}

declare module "write-file-atomic" {
  type WriteFileAtomicOptions = {
    fsync?: boolean;
  };

  export default function writeFileAtomic(
    filename: string,
    data: string | Uint8Array,
    options?: WriteFileAtomicOptions
  ): Promise<void>;
}
