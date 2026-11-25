import { Command, CommandRunner, Option } from 'nest-commander';
import { FamilyRole } from 'src/family/family.enum.js';
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

/**
immich-admin family-add-member --email <email> [--role member|viewer|admin]
Brings an existing account into the family (their photos and people join it). Safe to run again.
*/
@Command({ name: 'family-add-member', description: 'Add an existing user to the family' })
export class FamilyAddMemberCommand extends CommandRunner {
  constructor(private service: FamilyService) {
    super();
  }

  @Option({ flags: '-e, --email <email>', description: 'Email of the user to add' })
  parseEmail(value: string) {
    return value;
  }

  @Option({ flags: '-r, --role <role>', description: 'member (default), viewer or admin' })
  parseRole(value: string) {
    return value;
  }

  async run(_: string[], options: { email?: string; role?: string }): Promise<void> {
    const role = (options.role ?? FamilyRole.Member) as FamilyRole;
    if (!options.email || !Object.values(FamilyRole).includes(role)) {
      console.error('Usage: immich-admin family-add-member --email someone@example.com [--role member|viewer|admin]');
      process.exitCode = 1;
      return;
    }
    try {
      console.log(JSON.stringify(await this.service.addMemberFromCli({ email: options.email, role }), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}

/**
immich-admin family-release-sharing
Takes back the partner and album sharing the family wrote, restoring what was there before. Run it
before going back to stock Immich. Sharing the users set up themselves is left alone.
*/
@Command({ name: 'family-release-sharing', description: 'Remove the sharing the family created and restore earlier sharing' })
export class FamilyReleaseSharingCommand extends CommandRunner {
  constructor(private service: FamilyService) {
    super();
  }

  async run(): Promise<void> {
    try {
      console.log(JSON.stringify(await this.service.releaseSharingFromCli(), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
