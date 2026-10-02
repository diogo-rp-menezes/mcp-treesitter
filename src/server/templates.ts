export interface LanguageTemplates {
  [templateName: string]: string;
}

export const TEMPLATES: Record<string, LanguageTemplates> = {
  python: {
    functions: `(function_definition
  name: (identifier) @function.name
  parameters: (parameters) @function.params
  body: (block) @function.body) @function.def`,
    classes: `(class_definition
  name: (identifier) @class.name
  superclasses: (argument_list)? @class.supers
  body: (block) @class.body) @class.def`,
    imports: `[
  (import_statement) @import
  (import_from_statement) @import.from
]`,
    calls: `(call
  function: (identifier) @call.name
  arguments: (argument_list) @call.args) @call`,
    comments: `(comment) @comment`,
    errors: `(ERROR) @error`,
  },
  javascript: {
    functions: `[
  (function_declaration
    name: (identifier) @function.name
    parameters: (formal_parameters) @function.params
    body: (statement_block) @function.body) @function.def
  (arrow_function
    parameters: [
      (formal_parameters)
      (identifier)
    ] @function.params
    body: [
      (statement_block)
      (expression)
    ] @function.body) @function.def
  (method_definition
    name: (property_identifier) @method.name
    parameters: (formal_parameters) @method.params
    body: (statement_block) @method.body) @method.def
]`,
    classes: `(class_declaration
  name: (identifier) @class.name
  body: (class_body) @class.body) @class.def`,
    imports: `[
  (import_statement) @import
  (call_expression
    function: (identifier) @require (#eq? @require "require")) @import.require
]`,
    calls: `(call_expression
  function: [
    (identifier) @call.name
    (member_expression property: (property_identifier) @call.method)
  ]
  arguments: (arguments) @call.args) @call`,
    comments: `(comment) @comment`,
    errors: `(ERROR) @error`,
  },
  typescript: {
    functions: `[
  (function_declaration
    name: (identifier) @function.name
    parameters: (formal_parameters) @function.params
    return_type: (type_annotation)? @function.return_type
    body: (statement_block) @function.body) @function.def
  (arrow_function
    parameters: [
      (formal_parameters)
      (identifier)
    ] @function.params
    body: [
      (statement_block)
      (expression)
    ] @function.body) @function.def
  (method_definition
    name: (property_identifier) @method.name
    parameters: (formal_parameters) @method.params
    body: (statement_block) @method.body) @method.def
]`,
    classes: `(class_declaration
  name: (type_identifier) @class.name
  body: (class_body) @class.body) @class.def`,
    interfaces: `(interface_declaration
  name: (type_identifier) @interface.name
  body: (interface_body) @interface.body) @interface.def`,
    imports: `(import_statement
  (import_clause) @import.clause
  source: (string) @import.source) @import`,
    calls: `(call_expression
  function: [
    (identifier) @call.name
    (member_expression property: (property_identifier) @call.method)
  ]
  arguments: (arguments) @call.args) @call`,
    comments: `(comment) @comment`,
    errors: `(ERROR) @error`,
  },
  go: {
    functions: `[
  (function_declaration
    name: (identifier) @function.name
    parameters: (parameter_list) @function.params
    body: (block) @function.body) @function.def
  (method_declaration
    receiver: (parameter_list) @method.receiver
    name: (field_identifier) @method.name
    parameters: (parameter_list) @method.params
    body: (block) @method.body) @method.def
]`,
    classes: `(type_spec
  name: (type_identifier) @type.name
  type: [
    (struct_type) @struct
    (interface_type) @interface
  ]) @type.def`,
    imports: `(import_declaration) @import`,
    calls: `(call_expression
  function: [
    (identifier) @call.name
    (selector_expression field: (field_identifier) @call.selector)
  ]
  arguments: (argument_list) @call.args) @call`,
    comments: `(comment) @comment`,
    errors: `(ERROR) @error`,
  },
  rust: {
    functions: `(function_item
  name: (identifier) @function.name
  parameters: (parameters) @function.params
  body: (block) @function.body) @function.def`,
    classes: `[
  (struct_item name: (type_identifier) @struct.name) @struct.def
  (enum_item name: (type_identifier) @enum.name) @enum.def
  (trait_item name: (type_identifier) @trait.name) @trait.def
  (impl_item) @impl.def
]`,
    imports: `(use_declaration) @import`,
    calls: `(call_expression
  function: [
    (identifier) @call.name
    (field_expression field: (field_identifier) @call.field)
  ]
  arguments: (arguments) @call.args) @call`,
    comments: `(line_comment) @comment`,
    errors: `(ERROR) @error`,
  },
  java: {
    functions: `(method_declaration
  name: (identifier) @method.name
  parameters: (formal_parameters) @method.params
  body: (block) @method.body) @method.def`,
    classes: `[
  (class_declaration name: (identifier) @class.name) @class.def
  (interface_declaration name: (identifier) @interface.name) @interface.def
]`,
    imports: `(import_declaration) @import`,
    calls: `(method_invocation
  name: (identifier) @call.name
  arguments: (argument_list) @call.args) @call`,
    comments: `[
  (line_comment) @comment
  (block_comment) @comment
]`,
    errors: `(ERROR) @error`,
  },
  cpp: {
    functions: `(function_definition
  declarator: (function_declarator
    declarator: (identifier) @function.name
    parameters: (parameter_list) @function.params)
  body: (compound_statement) @function.body) @function.def`,
    classes: `[
  (class_specifier name: (type_identifier) @class.name) @class.def
  (struct_specifier name: (type_identifier) @struct.name) @struct.def
]`,
    imports: `(preproc_include) @import`,
    calls: `(call_expression
  function: (identifier) @call.name
  arguments: (argument_list) @call.args) @call`,
    comments: `(comment) @comment`,
    errors: `(ERROR) @error`,
  },
  c: {
    functions: `(function_definition
  declarator: (function_declarator
    declarator: (identifier) @function.name
    parameters: (parameter_list) @function.params)
  body: (compound_statement) @function.body) @function.def`,
    classes: `(struct_specifier name: (type_identifier) @struct.name) @struct.def`,
    imports: `(preproc_include) @import`,
    calls: `(call_expression
  function: (identifier) @call.name
  arguments: (argument_list) @call.args) @call`,
    comments: `(comment) @comment`,
    errors: `(ERROR) @error`,
  },
};

export const COMMON_NODE_DESCRIPTIONS: Record<string, Record<string, string>> = {
  python: {
    module: 'Root node of a Python file containing statements',
    function_definition: 'Function or method definition starting with def keyword',
    class_definition: 'Class definition starting with class keyword',
    call: 'Function or method call expression',
    identifier: 'Variable, function, or class name token',
    parameters: 'List of function parameter definitions',
    argument_list: 'List of arguments passed to a function call',
    block: 'Indented block of statements',
    import_statement: 'Import statement (e.g. import os)',
    import_from_statement: 'Import from statement (e.g. from typing import Any)',
    comment: 'Comment starting with #',
    if_statement: 'Conditional if/elif/else block',
    for_statement: 'For loop statement',
    while_statement: 'While loop statement',
    return_statement: 'Function return statement',
  },
  javascript: {
    program: 'Root node of a JavaScript file',
    function_declaration: 'Function declaration with function keyword',
    arrow_function: 'Arrow function expression (() => ...)',
    class_declaration: 'Class declaration with class keyword',
    method_definition: 'Method inside a class or object literal',
    call_expression: 'Function or method invocation',
    identifier: 'Identifier token',
    formal_parameters: 'Parameter list enclosed in parentheses',
    statement_block: 'Block of statements enclosed in braces { ... }',
    import_statement: 'ES6 import declaration',
    comment: 'Single-line or multi-line comment',
  },
  typescript: {
    program: 'Root node of a TypeScript file',
    function_declaration: 'Function declaration with optional type annotations',
    interface_declaration: 'TypeScript interface declaration',
    type_alias_declaration: 'Type alias declaration (type X = ...)',
    class_declaration: 'Class declaration',
    method_definition: 'Class or interface method',
    type_annotation: 'Type annotation (: string, : number, etc.)',
    call_expression: 'Function invocation',
    identifier: 'Identifier token',
  },
  go: {
    source_file: 'Root node of a Go source file',
    package_clause: 'Package definition header',
    import_declaration: 'Import block or single import',
    function_declaration: 'Function definition with func keyword',
    method_declaration: 'Method with receiver specification',
    type_spec: 'Type definition (struct, interface, alias)',
    call_expression: 'Function or method call',
  },
  rust: {
    source_file: 'Root node of a Rust source file',
    function_item: 'Function item defined with fn keyword',
    struct_item: 'Struct definition',
    enum_item: 'Enum definition',
    impl_item: 'Implementation block for struct or trait',
    trait_item: 'Trait definition',
    use_declaration: 'Use import statement',
    call_expression: 'Function call',
  },
};
