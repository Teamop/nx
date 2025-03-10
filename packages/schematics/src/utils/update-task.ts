import {
  Rule,
  SchematicContext,
  TaskConfiguration,
  TaskConfigurationGenerator,
  TaskExecutorFactory,
  Tree
} from '@angular-devkit/schematics';
import { Observable } from 'rxjs';
import { fork } from 'child_process';
import { join } from 'path';

let taskRegistered = false;

export function addUpdateTask(pkg: string, to: string): Rule {
  return (host: Tree, context: SchematicContext) => {
    // Workflow should always be there during ng update but not during tests.
    if (!context.engine.workflow) {
      return;
    }
    if (!taskRegistered) {
      const engineHost = (context.engine.workflow as any)._engineHost;
      engineHost.registerTaskExecutor(createRunUpdateTask());

      taskRegistered = true;
    }
    (context.engine as any)._taskSchedulers.forEach(scheduler => {
      if (
        scheduler._queue.peek() &&
        scheduler._queue.peek().configuration.name === 'RunUpdate' &&
        scheduler._queue.peek().configuration.options.package === pkg
      ) {
        scheduler._queue.pop();
      }
    });

    context.addTask(new RunUpdateTask(pkg, to));
  };
}

interface UpdateTaskOptions {
  package: string;
  to: string;
}

class RunUpdateTask implements TaskConfigurationGenerator<UpdateTaskOptions> {
  constructor(private _pkg: string, private _to: string) {}

  toConfiguration(): TaskConfiguration<UpdateTaskOptions> {
    return {
      name: 'RunUpdate',
      options: {
        package: this._pkg,
        to: this._to
      }
    };
  }
}

function createRunUpdateTask(): TaskExecutorFactory<UpdateTaskOptions> {
  return {
    name: 'RunUpdate',
    create: () => {
      return Promise.resolve(
        (options: UpdateTaskOptions, context: SchematicContext) => {
          context.logger.info(`Updating ${options.package} to ${options.to}`);
          const forkOptions = {
            stdio: [process.stdin, process.stdout, process.stderr, 'ipc'],
            shell: true
          };
          const ng = join('./node_modules', '@angular/cli', 'bin/ng');
          const args = [
            'update',
            `${options.package}@${options.to}`,
            '--force',
            '--allow-dirty'
          ].filter(e => !!e);
          return new Observable(obs => {
            fork(ng, args, forkOptions).on('close', (code: number) => {
              if (code === 0) {
                obs.next();
                obs.complete();
              } else {
                const message = `${
                  options.package
                } migration failed, see above.`;
                obs.error(new Error(message));
              }
            });
          });
        }
      );
    }
  };
}
