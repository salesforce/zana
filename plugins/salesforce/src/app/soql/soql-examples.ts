export interface SoqlExample {
  id: string;
  name: string;
  soql: string;
  useToolingApi: boolean;
}

export const SOQL_EXAMPLES: readonly SoqlExample[] = [
  {
    id: 'account',
    name: 'Accounts',
    soql: 'SELECT Id, Name, Industry\nFROM Account\nLIMIT 50',
    useToolingApi: false
  },
  {
    id: 'bot-version',
    name: 'BotVersion',
    soql: 'SELECT Id, MasterLabel, Status, BotDefinitionId\nFROM BotVersion\nLIMIT 50',
    useToolingApi: true
  },
  {
    id: 'bot-definition',
    name: 'BotDefinition',
    soql: 'SELECT Id, DeveloperName, MasterLabel\nFROM BotDefinition\nLIMIT 50',
    useToolingApi: true
  }
];

export const DEFAULT_SOQL = SOQL_EXAMPLES[0]!.soql;
