const {
  isCamelCase,
  toCamelCase,
  isPascalCase,
  toPascalCase,
  isSnakeCase,
  toSnakeCase,
} = require("../../utils/namingUtils.js");

describe("namingUtils", () => {
  // isCamelCase
  describe("isCamelCase", () => {
    it("returns true for valid camelCase", () => {
      expect(isCamelCase("myVariableName")).toBe(true);
    });

    it("returns false if starts with uppercase", () => {
      expect(isCamelCase("MyVariable")).toBe(false);
    });

    it("returns false if no uppercase after first character", () => {
      expect(isCamelCase("myvariablename")).toBe(false);
    });

    it("returns false for invalid characters", () => {
      expect(isCamelCase("my-variable")).toBe(false);
      expect(isCamelCase("my_variable")).toBe(false);
    });
  });

  // toCamelCase
  describe("toCamelCase", () => {
    it("converts snake_case to camelCase", () => {
      expect(toCamelCase("my_variable_name")).toBe("myVariableName");
    });

    it("converts kebab-case to camelCase", () => {
      expect(toCamelCase("my-variable-name")).toBe("myVariableName");
    });

    it("handles leading underscores/dashes", () => {
      expect(toCamelCase("__my__name__")).toBe("myName");
      expect(toCamelCase("--foo--bar")).toBe("fooBar");
    });

    it("converts already camelCase input safely", () => {
      expect(toCamelCase("myVariableName")).toBe("myvariablename");
    });
  });

  // isPascalCase
  describe("isPascalCase", () => {
    it("returns true for valid PascalCase", () => {
      expect(isPascalCase("MyClassName")).toBe(true);
    });

    it("returns false if starts lowercase", () => {
      expect(isPascalCase("myClassName")).toBe(false);
    });

    it("returns false if only capital letters", () => {
      expect(isPascalCase("MYNAME")).toBe(false);
    });

    it("returns false for invalid characters", () => {
      expect(isPascalCase("My_Class")).toBe(false);
    });
  });

  // toPascalCase
  describe("toPascalCase", () => {
    it("converts camelCase to PascalCase", () => {
      expect(toPascalCase("myClassName")).toBe("MyClassName");
    });

    it("converts snake_case to PascalCase", () => {
      expect(toPascalCase("my_class_name")).toBe("MyClassName");
    });

    it("converts kebab-case to PascalCase", () => {
      expect(toPascalCase("my-class-name")).toBe("MyClassName");
    });

    it("converts ALLCAPS to PascalCase", () => {
      expect(toPascalCase("MY_NAME")).toBe("MyName");
    });

    it("handles mixed casing and spacing", () => {
      expect(toPascalCase("my Name_with-mixEDCase")).toBe(
        "MyNameWithMixEdcase"
      );
    });
  });

  // isSnakeCase
  describe("isSnakeCase", () => {
    it("returns true for valid snake_case", () => {
      expect(isSnakeCase("my_variable_name")).toBe(true);
    });

    it("returns false if no underscores", () => {
      expect(isSnakeCase("myvariablename")).toBe(false);
    });

    it("returns false for camelCase or PascalCase", () => {
      expect(isSnakeCase("myVariableName")).toBe(false);
      expect(isSnakeCase("MyVariableName")).toBe(false);
    });

    it("returns false for invalid characters", () => {
      expect(isSnakeCase("my-variable")).toBe(false);
    });
  });

  // toSnakeCase
  describe("toSnakeCase", () => {
    it("converts camelCase to snake_case", () => {
      expect(toSnakeCase("myVariableName")).toBe("my_variable_name");
    });

    it("converts PascalCase to snake_case", () => {
      expect(toSnakeCase("MyClassName")).toBe("my_class_name");
    });

    it("converts kebab-case to snake_case", () => {
      expect(toSnakeCase("my-variable-name")).toBe("my_variable_name");
    });

    it("converts spaced names to snake_case", () => {
      expect(toSnakeCase("My Class Name")).toBe("my_class_name");
    });

    it("handles ALLCAPS conversion correctly", () => {
      expect(toSnakeCase("MYURLParser")).toBe("myurl_parser");
    });
  });
});