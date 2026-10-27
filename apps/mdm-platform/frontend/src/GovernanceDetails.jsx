import React from 'react';
import {BusinessDetails} from './BusinessDetails.jsx';
import {readableGovernanceValue} from './handoffGovernancePresentation.js';

export function GovernanceDetails({value}){
  return <BusinessDetails value={readableGovernanceValue(value)}/>;
}
