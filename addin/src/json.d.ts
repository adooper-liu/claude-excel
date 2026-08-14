declare module "*.json" {
  const value: {
    name?: string;
    version?: string;
    description?: string;
    tools: Array<{ name: string; description: string; input_schema?: object }>;
  };
  export default value;
}

declare module "*.md" {
  const value: string;
  export default value;
}
