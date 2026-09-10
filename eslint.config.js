import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'scripts/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // The family rule: error classes end in Error, never Exception.
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'class', format: ['PascalCase'], custom: { regex: 'Exception$', match: false } },
      ],
    },
  },
  { files: ['tests/**/*.ts'], rules: { '@typescript-eslint/no-non-null-assertion': 'off' } },
  prettier,
  { files: ['**/*.js', '**/*.mjs'], ...tseslint.configs.disableTypeChecked },
);
