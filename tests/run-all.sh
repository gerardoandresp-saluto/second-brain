#!/bin/bash
echo "═══ Second Brain Test Suite ═══"
echo ""
echo "── Node.js Tests ──"
node --test tests/test-indexer.mjs tests/test-router.mjs tests/test-bootstrap.mjs tests/test-search.mjs tests/test-validator.mjs tests/test-graph.mjs tests/test-auto-populate.mjs tests/test-integration.mjs
NODE_EXIT=$?
echo ""
echo "── Shell Tests ──"
bash tests/test-init.sh
SHELL_EXIT=$?
echo ""
TOTAL=$(node --test tests/test-indexer.mjs tests/test-router.mjs tests/test-bootstrap.mjs tests/test-search.mjs tests/test-validator.mjs tests/test-graph.mjs tests/test-auto-populate.mjs tests/test-integration.mjs 2>&1 | grep "^ℹ tests" | awk '{print $NF}')
echo "═══ Total Node.js tests: $TOTAL ═══"
echo ""
# Shell tests
SHELL_RESULTS=$(bash tests/test-init.sh 2>&1 | tail -1)
echo "Shell tests: $SHELL_RESULTS"
echo ""
if [ $NODE_EXIT -ne 0 ] || [ $SHELL_EXIT -ne 0 ]; then
  echo "═══ Some tests FAILED ═══"
  exit 1
else
  echo "═══ All tests PASSED ═══"
  exit 0
fi
