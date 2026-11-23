import { Command, CommandRunner, Option } from 'nest-commander';
import { FamilyService } from 'src/family/family.service.js';

/**
immich-admin family-setup --email <admin email> [--name <family name>]
Turns an existing server admin's library into the family (for switching a stock server to the fork),
then prints counts to check against the old server. Safe to run again.
*/
@Command({ name: 'family-setup', description: 'Create the family from a server admin and report what it shares' })
export class FamilySetupCommand extends CommandRunner {
  constructor(private service: FamilyService) {
    super();
  }

  @Option({ flags: '-e, --email <email>', description: 'Email of the server admin who becomes the first family admin' })
  parseEmail(value: string) {
    return value;
  }

  @Option({ flags: '-n, --name <name>', description: 'Family name, e.g. "Baker family"' })
  parseName(value: string) {
    return value;
  }

  async run(_: string[], options: { email?: string; name?: string }): Promise<void> {
    if (!options.email) {
      console.error('Pass the admin email: immich-admin family-setup --email you@example.com');
      process.exitCode = 1;
      return;
    }
    try {
      const report = await this.service.setupFromCli({ email: options.email, name: options.name });
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
