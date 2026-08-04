'use strict';

const { execFileSync } = require('child_process');
const { AppError } = require('./errors');

function gitOutput(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function repositoryState(repoRoot) {
  try {
    const commit = gitOutput(repoRoot, ['rev-parse', 'HEAD']);
    const status = gitOutput(repoRoot, ['status', '--porcelain', '--untracked-files=all']);
    return {
      commit,
      clean: status.length === 0
    };
  } catch (_) {
    throw new AppError(500, 'REPOSITORY_UNAVAILABLE', '无法读取Infomat试点版本。');
  }
}

function assertDeployableRepository(repoRoot, allowDirty = false) {
  const state = repositoryState(repoRoot);
  if (!allowDirty && !state.clean) {
    throw new AppError(
      500,
      'DIRTY_REPOSITORY',
      '服务器Infomat工作区存在未提交修改，禁止作为试点版本发布。'
    );
  }
  return state;
}

module.exports = {
  repositoryState,
  assertDeployableRepository
};
