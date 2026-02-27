# AI Chat Golden Set Test Results (10 tests)

## Status

**Fail** — Suite did not run or no results (compile error, crash, or OOM).

Exit code: 134

## Errors

```
console.log
    [dotenv@17.2.3] injecting env (2) from ..\..\.env -- tip: 👥 sync secrets across teammates & machines: https://dotenvx.com/ops

      at _log (../../node_modules/dotenv/lib/main.js:142:11)


<--- Last few GCs --->

[29644:000002839C681000]   476598 ms: Mark-Compact 4038.2 (4128.9) -> 4022.6 (4129.2) MB, pooled: 2 MB, 2683.14 / 0.00 ms  (average mu = 0.081, current mu = 0.006) allocation failure; scavenge might not succeed
[29644:000002839C681000]   479271 ms: Mark-Compact 4038.5 (4129.2) -> 4022.9 (4129.4) MB, pooled: 2 MB, 2653.73 / 0.00 ms  (average mu = 0.045, current mu = 0.007) allocation failure; scavenge might not succeed


<--- JS stacktrace --->

FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
----- Native stack trace -----

 1: 00007FF7C7A820AD node::SetCppgcReference+17245
 2: 00007FF7C79EA4D8 v8::base::CPU::num_virtual_address_bits+92376
 3: 00007FF7C856A1B1 v8::Isolate::ReportExternalAllocationLimitReached+65
 4: 00007FF7C8557096 v8::Function::Experimental_IsNopFunction+2790
 5: 00007FF7C83A6920 v8::internal::StrongRootAllocatorBase::StrongRootAllocatorBase+31392
 6: 00007FF7C83A0644 v8::internal::StrongRootAllocatorBase::StrongRootAllocatorBase+6084
 7: 00007FF7C839BCF5 v8::CpuProfileNode::GetScriptResourceNameStr+188069
 8: 00007FF7C7D213BD BIO_ssl_shutdown+189
```

## Notes

- Run from repo root: `node apps/api/scripts/run-ai-chat-tests-and-report.mjs`
- Or from apps/api: `node scripts/run-ai-chat-tests-and-report.mjs`