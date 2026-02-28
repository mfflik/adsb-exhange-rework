// Type declarations for WGSL shader imports via Vite's ?raw query
declare module '*.wgsl?raw' {
  const content: string;
  export default content;
}

declare module '*.wgsl' {
  const content: string;
  export default content;
}
