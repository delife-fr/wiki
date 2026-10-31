const {buildSchema, parse, validate} = require('graphql'); const {getVariableValues} = require('graphql/execution/values');
const fs = require('fs');
const schema = buildSchema(fs.readFileSync(__dirname + '/node_modules/@octokit/graphql-schema/schema.graphql', 'utf8'), {assumeValidSDL: true});
module.exports = (requete, variables) => {
  let d; try { d = parse(requete); } catch (e) { return [e.message]; }
  const e = validate(schema, d).map(x => x.message);
  const op = d.definitions.find(x => x.kind === 'OperationDefinition');
  const vv = getVariableValues(schema, op.variableDefinitions || [], variables || {});
  return [...e, ...(vv.errors || []).map(x => x.message)];
};
if (require.main === module) {
  const v = module.exports;
  const tests = [
    ['tete', 'query($p:String!,$n:String!,$r:String!){repository(owner:$p,name:$n){ref(qualifiedName:$r){target{oid ... on Commit{tree{oid}}}}}}', {p: 'a', n: 'b', r: 'refs/heads/main'}],
    ['textes', 'query($p:String!,$n:String!){repository(owner:$p,name:$n){b0:object(oid:"' + 'a'.repeat(40) + '"){... on Blob{text isTruncated}} b1:object(oid:"' + 'b'.repeat(40) + '"){... on Blob{text isTruncated}}}}', {p: 'a', n: 'b'}],
    ['commit', 'mutation($e:CreateCommitOnBranchInput!){createCommitOnBranch(input:$e){commit{oid tree{oid}}}}', {e: {branch: {repositoryNameWithOwner: 'a/b', branchName: 'main'}, expectedHeadOid: 'a'.repeat(40), message: {headline: 'x', body: 'y'}, fileChanges: {additions: [{path: 'a.md', contents: 'eA=='}], deletions: [{path: 'b.md'}]}}}],
    ['contrôle (doit échouer)', 'query{repository(owner:"a",name:"b"){nimporte}}', {}],
  ];
  for (const [n, q, vars] of tests) { const e = v(q, vars); console.log(n, ':', e.length ? e : 'VALIDE (requête et variables)'); }
}
