<?php

namespace ProjectManager\Analyzer;

use PhpParser\Error;
use PhpParser\Node;
use PhpParser\NodeTraverser;
use PhpParser\NodeVisitorAbstract;
use PhpParser\ParserFactory;
use PhpParser\PhpVersion;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use FilesystemIterator;

class PhpAnalyzer
{
    private string $projectPath;
    private array $files = [];
    private array $globalDependencies = [];
    private array $globalDbReferences = [];
    private array $namespaceMap = [];
    private array $classMap = [];

    public function __construct(string $projectPath)
    {
        $this->projectPath = rtrim($projectPath, '/\\');
    }

    public function analyze(): array
    {
        $phpFiles = $this->findPhpFiles();
        $this->buildNamespaceMap($phpFiles);

        foreach ($phpFiles as $filePath) {
            try {
                $fileInfo = $this->analyzeFile($filePath);
                if ($fileInfo !== null) {
                    $this->files[] = $fileInfo;
                }
            } catch (Throwable $e) {
                $this->files[] = [
                    'path' => $filePath,
                    'relativePath' => $this->getRelativePath($filePath),
                    'size' => file_exists($filePath) ? filesize($filePath) : 0,
                    'lines' => 0,
                    'isDir' => false,
                    'classes' => [],
                    'traits' => [],
                    'interfaces' => [],
                    'functions' => [],
                    'dependencies' => [],
                    'dbReferences' => [],
                    'error' => $e->getMessage() . ':' . $e->getLine(),
                ];
            }
        }

        $this->resolveDependencies();

        return $this->buildResult();
    }

    private function findPhpFiles(): array
    {
        $files = [];
        $directory = new RecursiveDirectoryIterator(
            $this->projectPath,
            FilesystemIterator::SKIP_DOTS | FilesystemIterator::FOLLOW_SYMLINKS
        );
        $iterator = new RecursiveIteratorIterator($directory);

        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $realPath = $file->getRealPath();
                if ($realPath !== false) {
                    $files[] = $realPath;
                }
            }
        }

        sort($files);
        return $files;
    }

    private function buildNamespaceMap(array $files): void
    {
        $parser = (new ParserFactory())->createForVersion(PhpVersion::fromString('8.0'));

        foreach ($files as $filePath) {
            $code = @file_get_contents($filePath);
            if ($code === false) continue;

            try {
                $ast = $parser->parse($code);
            } catch (Error) {
                continue;
            }

            if ($ast === null) continue;

            $relativePath = $this->getRelativePath($filePath);
            $namespace = '';
            $this->walkForClassMap($ast, $relativePath, $namespace);
        }
    }

    private function walkForClassMap(array $nodes, string $relativePath, string &$namespace): void
    {
        foreach ($nodes as $node) {
            if ($node instanceof Node\Stmt\Namespace_) {
                $oldNamespace = $namespace;
                $namespace = $node->name ? implode('\\', $node->name->getParts()) : '';
                if ($node->stmts) {
                    $this->walkForClassMap($node->stmts, $relativePath, $namespace);
                }
                $namespace = $oldNamespace;
                continue;
            }
            if ($node instanceof Node\Stmt\Class_ && $node->name) {
                $className = $node->name->name;
                $fullName = $namespace ? $namespace . '\\' . $className : $className;
                $this->classMap[$fullName] = $relativePath;
                if ($node->extends) {
                    $parentName = $node->extends->getAttribute('originalName');
                    if ($parentName) {
                        $parentStr = $parentName instanceof Node\Name ? implode('\\', $parentName->getParts()) : (string)$parentName;
                        $fullParent = $namespace ? $namespace . '\\' . $parentStr : $parentStr;
                        $this->classMap[$fullParent] = $this->classMap[$fullParent] ?? $relativePath;
                    }
                }
                continue;
            }
            if (property_exists($node, 'stmts') && $node->stmts) {
                $this->walkForClassMap($node->stmts, $relativePath, $namespace);
            }
        }
    }

    private function analyzeFile(string $filePath): ?array
    {
        $code = @file_get_contents($filePath);
        if ($code === false) return null;

        $relativePath = $this->getRelativePath($filePath);
        $lines = substr_count($code, "\n") + 1;
        $size = filesize($filePath);

        $parser = (new ParserFactory())->createForVersion(PhpVersion::fromString('8.0'));

        try {
            $ast = $parser->parse($code);
        } catch (Error) {
            return [
                'path' => $filePath,
                'relativePath' => $relativePath,
                'size' => $size,
                'lines' => $lines,
                'isDir' => false,
                'classes' => [],
                'traits' => [],
                'interfaces' => [],
                'functions' => [],
                'dependencies' => $this->findDependenciesRegex($code, $relativePath),
                'dbReferences' => $this->findDbReferencesRegex($code),
            ];
        }

        if ($ast === null) return null;

        $context = new AnalysisContext($relativePath);

        $traverser = new NodeTraverser();
        $traverser->addVisitor(new FileAnalysisVisitor($context));

        $traverser->traverse($ast);

        $regexDeps = $this->findDependenciesRegex($code, $relativePath);
        $regexDbRefs = $this->findDbReferencesRegex($code);

        $allDeps = array_merge($context->dependencies, $regexDeps);
        $allDbRefs = array_merge($context->dbReferences, $regexDbRefs);

        $allDbRefs = $this->deduplicateDbRefs($allDbRefs);
        $allDeps = $this->deduplicateDeps($allDeps);

        $this->globalDependencies = array_merge($this->globalDependencies, $allDeps);
        $this->globalDbReferences = array_merge($this->globalDbReferences, $allDbRefs);

        return [
            'path' => $filePath,
            'relativePath' => $relativePath,
            'size' => $size,
            'lines' => $lines,
            'isDir' => false,
            'classes' => $context->classes,
            'traits' => $context->traits,
            'interfaces' => $context->interfaces,
            'functions' => $context->functions,
            'dependencies' => $allDeps,
            'dbReferences' => $allDbRefs,
        ];
    }

    private function findDependenciesRegex(string $code, string $relativePath): array
    {
        $deps = [];

        $patterns = [
            '/include\s+(__DIR__\s*\.\s*)?[\'"]([^\'"]+)[\'"]\s*;/',
            '/include_once\s+(__DIR__\s*\.\s*)?[\'"]([^\'"]+)[\'"]\s*;/',
            '/require\s+(__DIR__\s*\.\s*)?[\'"]([^\'"]+)[\'"]\s*;/',
            '/require_once\s+(__DIR__\s*\.\s*)?[\'"]([^\'"]+)[\'"]\s*;/',
        ];

        foreach ($patterns as $pattern) {
            $type = 'include';
            if (str_contains($pattern, 'require')) {
                $type = 'require';
            }
            if (preg_match_all($pattern, $code, $matches, PREG_SET_ORDER)) {
                foreach ($matches as $match) {
                    $target = end($match);
                    $deps[] = [
                        'type' => $type,
                        'target' => $target,
                        'resolvedPath' => null,
                        'line' => 0,
                    ];
                }
            }
        }

        return $deps;
    }

    private function findDbReferencesRegex(string $code): array
    {
        $refs = [];

        // Raw SQL patterns
        $patterns = [
            'SELECT' => '/\bSELECT\b.+?\bFROM\b\s+[`\'"]?([a-zA-Z_][a-zA-Z0-9_]*)[`\'"]?/si',
            'INSERT' => '/\bINSERT\s+INTO\b\s+[`\'"]?([a-zA-Z_][a-zA-Z0-9_]*)[`\'"]?/si',
            'UPDATE' => '/\bUPDATE\b\s+[`\'"]?([a-zA-Z_][a-zA-Z0-9_]*)[`\'"]?/si',
            'DELETE' => '/\bDELETE\b.+?\bFROM\b\s+[`\'"]?([a-zA-Z_][a-zA-Z0-9_]*)[`\'"]?/si',
        ];

        // ORM patterns: DB::table(), ->table(), ->from(), Schema::create(), Schema::table()
        $ormPatterns = [
            'ORM_TABLE' => '/[`\'"]?([a-zA-Z_][a-zA-Z0-9_]*)[`\'"]?\s*\)\s*->(?:get|first|find|where|orderBy|groupBy|having|limit|offset|pluck|value|count|exists|delete|update|insert)/si',
            'ORM_DB_TABLE' => '/(?:DB|Schema|\\w+::)\s*::\s*(?:table|create|drop|hasTable|hasColumn)\s*\(\s*[`\'"]?([a-zA-Z_][a-zA-Z0-9_]*)[`\'"]?\s*\)/si',
            'ORM_FROM' => '/->\s*from\s*\(\s*[`\'"]?([a-zA-Z_][a-zA-Z0-9_]*)[`\'"]?\s*\)/si',
            'ORM_JOIN' => '/->\s*join(?:Left|Right|Inner)?\s*\(\s*[`\'"]?([a-zA-Z_][a-zA-Z0-9_]*)[`\'"]?\s*[,\)]/si',
            'ORM_MODEL_QUERY' => '/([A-Z][a-zA-Z0-9_]+)::\s*(?:find|all|where|create|firstOrCreate|updateOrCreate|findOrFail|firstWhere|withCount|has|doesntHave)\s*\(/',
        ];

        // SQLite patterns
        $sqlitePatterns = [
            'SQLITE_OPEN' => '/(?:new\s+SQLite3|sqlite_open|SQLite3\s*\(|:memory:|\.sqlite[3"]?)/si',
            'SQLITE_ATTACH' => '/ATTACH\s+DATABASE\s+[`\'"]?([^`\'"]+)[`\'"]?\s+AS\s+[`\'"]?([^`\'"]+)[`\'"]?/si',
        ];

        $lines = explode("\n", $code);
        foreach ($lines as $lineNum => $line) {
            // Raw SQL patterns (require ->, query, or prepare on same line)
            foreach ($patterns as $operation => $pattern) {
                if (preg_match($pattern, $line, $matches)) {
                    $table = $matches[1];
                    if (str_contains($line, 'query') || str_contains($line, 'prepare') || str_contains($line, '->')) {
                        $refs[] = [
                            'table' => $table,
                            'operation' => $operation,
                            'context' => trim(substr($line, 0, 120)),
                            'line' => $lineNum + 1,
                        ];
                    }
                }
            }

            // ORM patterns
            foreach ($ormPatterns as $operation => $pattern) {
                if (preg_match($pattern, $line, $matches)) {
                    $table = $matches[1];
                    $refs[] = [
                        'table' => $table,
                        'operation' => $operation,
                        'context' => trim(substr($line, 0, 120)),
                        'line' => $lineNum + 1,
                    ];
                }
            }

            // SQLite patterns
            if (preg_match($sqlitePatterns['SQLITE_OPEN'], $line, $matches)) {
                $refs[] = [
                    'table' => 'sqlite',
                    'operation' => 'SQLITE',
                    'context' => trim(substr($line, 0, 120)),
                    'line' => $lineNum + 1,
                ];
            }
            if (preg_match($sqlitePatterns['SQLITE_ATTACH'], $line, $matches)) {
                $dbName = $matches[2] ?? 'attached';
                $refs[] = [
                    'table' => $dbName,
                    'operation' => 'SQLITE',
                    'context' => trim(substr($line, 0, 120)),
                    'line' => $lineNum + 1,
                ];
            }
        }

        return $refs;
    }

    private function deduplicateDbRefs(array $refs): array
    {
        $seen = [];
        $unique = [];
        foreach ($refs as $ref) {
            $key = $ref['table'] . '|' . $ref['operation'] . '|' . $ref['line'];
            if (!isset($seen[$key])) {
                $seen[$key] = true;
                $unique[] = $ref;
            }
        }
        return $unique;
    }

    private function deduplicateDeps(array $deps): array
    {
        $seen = [];
        $unique = [];
        foreach ($deps as $dep) {
            $key = $dep['type'] . '|' . $dep['target'] . '|' . $dep['line'];
            if (!isset($seen[$key])) {
                $seen[$key] = true;
                $unique[] = $dep;
            }
        }
        return $unique;
    }

    private function resolveDependencies(): void
    {
        foreach ($this->files as &$file) {
            foreach ($file['dependencies'] as &$dep) {
                if ($dep['type'] === 'use') {
                    $className = ltrim($dep['target'], '\\');
                    $className = is_object($className) ? (string)$className : $className;
                    if (isset($this->classMap[$className])) {
                        $dep['resolvedPath'] = $this->classMap[$className];
                    } else {
                        $parts = explode('\\', $className);
                        $shortName = end($parts);
                        foreach ($this->classMap as $fullClass => $path) {
                            if (str_ends_with($fullClass, '\\' . $shortName)) {
                                $dep['resolvedPath'] = $path;
                                break;
                            }
                        }
                    }
                } elseif (in_array($dep['type'], ['include', 'require'])) {
                    $target = $dep['target'];
                    $baseDir = dirname($file['path']);
                    $possiblePaths = [
                        $baseDir . '/' . $target,
                        dirname($this->projectPath) . '/' . $target,
                        $this->projectPath . '/' . ltrim($target, '/'),
                    ];
                    foreach ($possiblePaths as $pp) {
                        $real = @realpath($pp);
                        if ($real !== false && file_exists($real)) {
                            $dep['resolvedPath'] = $this->getRelativePath($real);
                            break;
                        }
                    }
                }
            }
            unset($dep);
        }
        unset($file);
    }

    private function buildResult(): array
    {
        $totalFiles = 0;
        $totalLines = 0;
        $totalClasses = 0;
        $totalDirs = 0;

        foreach ($this->files as $file) {
            $totalFiles++;
            $totalLines += $file['lines'];
            $totalClasses += count($file['classes']);
        }

        $totalDep = count($this->globalDependencies);
        $totalDb = count($this->globalDbReferences);

        return [
            'projectPath' => $this->projectPath,
            'projectName' => basename($this->projectPath),
            'analyzedAt' => date('c'),
            'summary' => [
                'totalFiles' => $totalFiles,
                'totalDirs' => $totalDirs,
                'totalLines' => $totalLines,
                'totalClasses' => $totalClasses,
                'totalDependencies' => $totalDep,
                'totalDbReferences' => $totalDb,
            ],
            'files' => $this->files,
        ];
    }

    private function getRelativePath(string $filePath): string
    {
        return str_replace($this->projectPath . '/', '', $filePath);
    }
}

class AnalysisContext
{
    public string $relativePath;
    public string $namespace = '';
    public array $dependencies = [];
    public array $dbReferences = [];
    public array $classes = [];
    public array $traits = [];
    public array $interfaces = [];
    public array $functions = [];

    public function __construct(string $relativePath)
    {
        $this->relativePath = $relativePath;
    }
}

class FileAnalysisVisitor extends NodeVisitorAbstract
{
    private AnalysisContext $context;

    public function __construct(AnalysisContext $context)
    {
        $this->context = $context;
    }

    public function enterNode(Node $node): void
    {
        if ($node instanceof Node\Stmt\Namespace_) {
            $this->context->namespace = $node->name ? implode('\\', $node->name->getParts()) : '';
        }

        if ($node instanceof Node\Stmt\UseUse) {
            $target = $node->name ? implode('\\', $node->name->getParts()) : '';
            if ($target) {
                $this->context->dependencies[] = [
                    'type' => 'use',
                    'target' => $target,
                    'resolvedPath' => null,
                    'line' => $node->getLine(),
                ];
            }
        }

        if ($node instanceof Node\Expr\Include_) {
            $expr = $node->expr;
            $target = '';
            if ($expr instanceof Node\Scalar\String_) {
                $target = $expr->value;
            }
            if ($target) {
                $includeType = $node->type === Node\Expr\Include_::TYPE_INCLUDE ? 'include' : 'require';
                $this->context->dependencies[] = [
                    'type' => $includeType,
                    'target' => $target,
                    'resolvedPath' => null,
                    'line' => $node->getLine(),
                ];
            }
        }

        if ($node instanceof Node\Stmt\Class_) {
            if ($node->name) {
                $extends = $node->extends ? implode('\\', $node->extends->getParts()) : null;
                $implements = [];
                foreach ($node->implements as $impl) {
                    $implements[] = implode('\\', $impl->getParts());
                }
                $methods = [];
                $props = [];
                foreach ($node->getMethods() as $method) {
                    $methods[] = $method->name->name;
                }
                foreach ($node->getProperties() as $prop) {
                    foreach ($prop->props as $p) {
                        $props[] = $p->name->name;
                    }
                }
                $this->context->classes[] = [
                    'name' => $node->name->name,
                    'namespace' => $this->context->namespace,
                    'fullName' => $this->context->namespace ? $this->context->namespace . '\\' . $node->name->name : $node->name->name,
                    'type' => $node->isAbstract() ? 'abstract class' : 'class',
                    'methods' => $methods,
                    'properties' => $props,
                    'extends' => $extends,
                    'implements' => $implements,
                ];
            }
        }

        if ($node instanceof Node\Stmt\Interface_) {
            if ($node->name) {
                $this->context->interfaces[] = $node->name->name;
            }
        }

        if ($node instanceof Node\Stmt\Trait_) {
            if ($node->name) {
                $this->context->traits[] = $node->name->name;
            }
        }

        if ($node instanceof Node\Stmt\Function_) {
            if ($node->name) {
                $this->context->functions[] = $node->name->name;
            }
        }
    }
}
