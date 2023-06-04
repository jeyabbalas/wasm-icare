/**
 * @module wasm-icare
 */

/**
 * Wrapper class to hold the iCARE Wasm object and add web-specific functionalities to its methods.
 * @class
 * @property {object} icare - The iCARE Wasm object.
 * @property {string} __version__ - The version of the iCARE Python package.
 */
class WasmICARE {
    /**
     * Constructor for the WasmICARE class. This class is not meant to be instantiated directly. Use the
     * 'initialize()' method to instantiate this class.
     */
    constructor() {
        this.version = '1.0.0';
        // Version of the iCARE Python package to load from PyPI.
        this.pyICareVersion = '1.0.0';
        // Version of Pyodide to load from the CDN.
        this.pyodideVersion = '0.23.2';
        // URL to load Pyodide from the CDN.
        this.pyodideEsmUrl = 'https://cdn.jsdelivr.net/npm/pyodide@' + this.pyodideVersion + '/+esm';
        // URL to the location of Python packages on the CDN.
        this.pyodideRootUrl = 'https://cdn.jsdelivr.net/pyodide/v' + this.pyodideVersion + '/full/';
    }

    /**
     * Factory method to instantiate the WasmICARE class.
     * @returns {Promise<WasmICARE>}
     */
    static async initialize() {
        const instance = new WasmICARE();
        // instantiate Pyodide
        instance.pyodide = await (await import(instance.pyodideEsmUrl)).loadPyodide({indexURL: instance.pyodideRootUrl});

        // instantiate iCARE
        await instance.pyodide.loadPackage('micropip');
        const micropip = instance.pyodide.pyimport('micropip');
        await micropip.install('pyicare=='.concat(instance.pyICareVersion));
        instance.pyodide.runPython(`import icare`);

        return instance;
    }

    _getFileNameOrNone(url) {
        const fileName = url.substring(url.lastIndexOf('/') + 1);
        return url ? JSON.stringify(fileName) : 'None';
    }

    _valueOrNone(value) {
        return value ? JSON.stringify(value) : 'None';
    }

    /**
     * Method to load files from a list of URLs and write them to the Pyodide file system.
     * @param fileURLs
     * @returns {Promise<Awaited<unknown>[]>}
     */
    async fetchFilesAndWriteToPyodideFS(fileURLs) {
        if (!this.pyodide) {
            throw new Error('Please instantiate this class using the WasmICARE.initialize() method.');
        }

        async function fetchAndWriteFile(url) {
            try {
                const response = await fetch(url);

                if (!response.ok) {
                    console.error(`Failed to fetch file from ${url}`);
                    return {isError: true, message: `Failed to fetch file from ${url}`};
                }

                const fileContent = await response.text();
                const fileName = url.substring(url.lastIndexOf('/') + 1);
                this.pyodide.FS.writeFile(fileName, fileContent);

                return {isError: false, message: `File ${fileName} successfully loaded to the Pyodide file system.`};
            } catch (error) {
                console.error(`Error fetching and writing file: ${error.message}`);
                return {isError: true, message: `Error fetching and writing file: ${error.message}`};
            }
        }

        return await Promise.all(fileURLs.map(fetchAndWriteFile));
    }

    /**
     * Method to convert the Wasm-iCARE output to JSON.
     * @param obj
     * @returns {{}|*}
     */
    convertOutputToJSON(obj) {
        if (obj instanceof Map) {
            const result = {};
            obj.forEach((value, key) => {
                result[key] = this.convertOutputToJSON(value);
            });
            return result;
        }

        if (Array.isArray(obj)) {
            return obj.map((item) => this.convertOutputToJSON(item));
        }

        return obj;
    }

    /**
     * This method is used to build absolute risk models and apply them to estimate absolute risks.
     * @async
     * @function
     * @param applyAgeStart
     *  Age(s) for the start of the interval, over which, to compute the absolute risk. If a single integer is provided,
     *  all instances in the profiles ('applyCovariateProfileUrl' and/or 'applySnpProfileUrl') are assigned this start
     *  age for the interval. If a different start age needs to be assigned for each instance, provide an array of ages
     *  as integers of the same length as the number of instances in these profiles.
     * @param applyAgeIntervalLength
     *  Number of years over which to compute the absolute risk. That is to say that the age at the end of the interval
     *  is 'applyAgeStart' + 'applyAgeIntervalLength'. If a single integer is provided, all instances in the profiles
     *  ('applyCovariateProfileUrl' and/or 'applySnpProfileUrl') are assigned this interval length. If a different
     *  interval length needs to be assigned for each instance, provide an array of interval lengths as integers of the
     *  same length as the number of instances in these profiles.
     * @param modelDiseaseIncidenceRatesUrl
     *  A URL to a CSV file containing the age-specific disease incidence rates for the population of interest. The data
     *  in the file must either contain two columns, named: ['age', 'rate'], to specify the incidence rates associated
     *  with each age group; or three columns, named: ['start_age', 'end_age', 'rate'], to specify the incidence rates
     *  associated with each age interval. The age ranges must fully cover the age intervals specified using parameters
     *  'applyAgeStart' and 'applyAgeIntervalLength'.
     * @param modelCompetingIncidenceRatesUrl
     *  A URL to a CSV file containing the age-specific incidence rates for competing events in the population of
     *  interest. The data in the file must either contain two columns, named: ['age', 'rate'], to specify the incidence
     *  rates associated with each age group; or three columns, named: ['start_age', 'end_age', 'rate'], to specify the
     *  incidence rates associated with each age interval. The age ranges must fully cover the age intervals specified
     *  using parameters 'applyAgeStart' and 'applyAgeIntervalLength'.
     * @param modelCovariateFormulaUrl
     *  A URL to a text file containing a Patsy symbolic description string of the model to be fitted,
     *  e.g. Y ~ parity + family_history.
     *  Reference: https://patsy.readthedocs.io/en/latest/formulas.html#the-formula-language
     *  Please make sure that the variable name in your dataset is not from the namespace of the Python execution
     *  context, including Python standard library, numpy, pandas, patsy, and icare. For example, a variable name "C"
     *  and "Q" would conflict with Patsy built-in functions of the same name. Variable names with the R-style periods
     *  in them should be surrounded by the Patsy quote function Q(family.history). In Python, periods are used to
     *  access attributes of objects, so they are not allowed in Patsy variable names unless surrounded by Q(). Patsy
     *  language is similar to R's formula object (https://patsy.readthedocs.io/en/latest/R-comparison.html).
     * @param modelLogRelativeRiskUrl
     *  A URL to a JSON file containing the log odds ratios, of the variables in the model except the intercept term, in
     *  association with the disease. The first-level JSON keys should correspond to the variable names generated by
     *  Patsy when building the design matrix. Their values should correspond to the log odds ratios of the variable's
     *  association with the disease.
     * @param modelReferenceDatasetUrl
     *  A URL to a CSV file containing the reference dataset with risk factor distribution that is representative of
     *  the population of interest. No missing values are permitted in this dataset.
     * @param modelReferenceDatasetWeightsVariableName
     *  A string specifying the name of the variable in the dataset at 'modelReferenceDatasetUrl' that indicates the
     *  sampling weight for each instance. If set to None (default), then a uniform weight will be assigned to each
     *  instance.
     * @param modelSnpInfoUrl
     *  A URL to a CSV file containing the information about the SNPs in the model. The data should contain three
     *  columns, named: ['snp_name', 'snp_odds_ratio', 'snp_freq'] corresponding to the SNP ID, the odds ratio of the
     *  SNP in association with the disease, and the minor allele frequency, respectively.
     * @param modelFamilyHistoryVariableName
     *  A string specifying the name of the binary variable (values: {0, 1}; missing values are permitted) in the model
     *  formula ('modelCovariateFormulaUrl') that represents the family history of the disease. This needs to be
     *  specified when using the special SNP model option so that the effect of family history can be adjusted for the
     *  presence of the SNPs.
     * @param numImputations
     *  The number of imputations for handling missing SNPs.
     * @param applyCovariateProfileUrl
     *  A URL to a CSV file containing the covariate (risk factor) profiles of the individuals for whom the absolute
     *  risk is to be computed. Missing values are permitted.
     * @param applySnpProfileUrl
     *  A URL to a CSV file containing the SNP profiles (values: {0: homozygous reference alleles, 1: heterozygous,
     *  2: homozygous alternate alleles}) of the individuals for whom the absolute risk is to be computed. Missing
     *  values are permitted.
     * @param returnLinearPredictors
     *  Set true to return the calculated linear predictor values for each individual in the 'applyCovariateProfileUrl'
     *  and/or 'applySnpProfileUrl' datasets.
     * @param returnReferenceRisks
     *  Set true to return the absolute risk estimates for each individual in the 'modelReferenceDatasetUrl' dataset.
     * @param seed
     *  Fix a seed for reproducibility.
     * @returns {Promise<{}|*>}
     *  An object with the following keys—
     *      1) 'model':
     *          An object of feature names and the associated beta values that were used to compute the absolute risk
     *          estimates.
     *      2) 'profile':
     *          A records-oriented JSON of the input profile data, the specified age intervals, and the calculated
     *          absolute risk estimates. If 'returnLinearPredictors' is set to true, they are also included as an
     *          additional column.
     *      3) 'reference_risks':
     *          If 'returnReferenceRisks' is true, this key will be present in the returned object. It will contain an
     *          array of objects, one per unique combination of the specified age intervals, containing age at the start
     *          of interval ('age_interval_start'), age at the end of interval ('age_interval_end'), and a list absolute
     *          risk estimates for the individuals in the reference dataset ('population_risks').
     *      4) 'method':
     *          A string containing the name of the method used to calculate the absolute risk estimates. When this
     *          method is used, the method name is "iCARE - absolute risk".
     */
    async computeAbsoluteRisk(
        {
            applyAgeStart,
            applyAgeIntervalLength,
            modelDiseaseIncidenceRatesUrl,
            modelCompetingIncidenceRatesUrl,
            modelCovariateFormulaUrl,
            modelLogRelativeRiskUrl,
            modelReferenceDatasetUrl,
            modelReferenceDatasetWeightsVariableName,
            modelSnpInfoUrl,
            modelFamilyHistoryVariableName,
            numImputations = 5,
            applyCovariateProfileUrl,
            applySnpProfileUrl,
            returnLinearPredictors = false,
            returnReferenceRisks = false,
            seed = 1234,
        }) {
        if (!this.pyodide) {
            throw new Error('Please instantiate this class using the WasmICARE.initialize() method.');
        }

        const fileURLs = [
            modelDiseaseIncidenceRatesUrl,
            modelCompetingIncidenceRatesUrl,
            modelCovariateFormulaUrl,
            modelLogRelativeRiskUrl,
            modelReferenceDatasetUrl,
            modelSnpInfoUrl,
            applyCovariateProfileUrl,
            applySnpProfileUrl,
        ].filter(url => url !== undefined);

        await this.fetchFilesAndWriteToPyodideFS(fileURLs);

        applyAgeStart = this._valueOrNone(applyAgeStart);
        applyAgeIntervalLength = this._valueOrNone(applyAgeIntervalLength);
        modelDiseaseIncidenceRatesUrl = this._getFileNameOrNone(modelDiseaseIncidenceRatesUrl);
        modelCompetingIncidenceRatesUrl = this._getFileNameOrNone(modelCompetingIncidenceRatesUrl);
        modelCovariateFormulaUrl = this._getFileNameOrNone(modelCovariateFormulaUrl);
        modelLogRelativeRiskUrl = this._getFileNameOrNone(modelLogRelativeRiskUrl);
        modelReferenceDatasetUrl = this._getFileNameOrNone(modelReferenceDatasetUrl);
        modelReferenceDatasetWeightsVariableName = this._valueOrNone(modelReferenceDatasetWeightsVariableName);
        modelSnpInfoUrl = this._getFileNameOrNone(modelSnpInfoUrl);
        modelFamilyHistoryVariableName = this._valueOrNone(modelFamilyHistoryVariableName);
        numImputations = this._valueOrNone(numImputations);
        applyCovariateProfileUrl = this._getFileNameOrNone(applyCovariateProfileUrl);
        applySnpProfileUrl = this._getFileNameOrNone(applySnpProfileUrl);
        returnLinearPredictors = returnLinearPredictors ? 'True' : 'False';
        returnReferenceRisks = returnReferenceRisks ? 'True' : 'False';
        seed = this._valueOrNone(seed);

        let result = this.pyodide.runPython(`
result = icare.compute_absolute_risk(
  apply_age_start = ${applyAgeStart},
  apply_age_interval_length = ${applyAgeIntervalLength},
  model_disease_incidence_rates_path = ${modelDiseaseIncidenceRatesUrl},
  model_competing_incidence_rates_path = ${modelCompetingIncidenceRatesUrl},
  model_covariate_formula_path = ${modelCovariateFormulaUrl},
  model_log_relative_risk_path = ${modelLogRelativeRiskUrl},
  model_reference_dataset_path = ${modelReferenceDatasetUrl},
  model_reference_dataset_weights_variable_name = ${modelReferenceDatasetWeightsVariableName},
  model_snp_info_path = ${modelSnpInfoUrl},
  model_family_history_variable_name = ${modelFamilyHistoryVariableName},
  num_imputations = ${numImputations},
  apply_covariate_profile_path = ${applyCovariateProfileUrl},
  apply_snp_profile_path = ${applySnpProfileUrl},
  return_linear_predictors = ${returnLinearPredictors},
  return_reference_risks = ${returnReferenceRisks},
  seed = ${seed}
)

result
`).toJs();

        if (result.isError) {
            throw new Error(result.message);
        }

        result = this.convertOutputToJSON(result);
        result['profile'] = JSON.parse(result['profile'])

        return result;
    }

    /**
     * This method is used to build an absolute risk model that incorporates different input parameters before and
     * after a given time cut-point. The model is then applied to estimate the combined absolute risks.
     * @async
     * @function
     * @param applyAgeStart
     *  Age(s) for the start of the interval, over which, to compute the absolute risk. If a single integer is provided,
     *  all instances in the profiles ('applyCovariateProfileCutpointUrl' and/or 'applySnpProfileUrl') are assigned this
     *  start age for the interval. If a different start age needs to be assigned for each instance, provide an array of
     *  ages as integers of the same length as the number of instances in these profiles. If an array is provided, the
     *  parameters 'applyAgeIntervalLength' and 'cutpoint' must also be arrays of the same length.
     * @param applyAgeIntervalLength
     *  Number of years over which to compute the absolute risk. That is to say that the age at the end of the interval
     *  is 'applyAgeStart' + 'applyAgeIntervalLength'. If a single integer is provided, all instances in the profiles
     *  ('applyCovariateProfileCutpointUrl' and/or 'applySnpProfileUrl') are assigned this interval length. If a
     *  different interval length needs to be assigned for each instance, provide an array of interval lengths as
     *  integers of the same length as the number of instances in these profiles. If an array is provided, the
     *  parameters 'applyAgeStart' and 'cutpoint' must also be arrays of the same length.
     * @param modelDiseaseIncidenceRatesUrl
     *  A URL to a CSV file containing the age-specific disease incidence rates for the population of interest. The data
     *  in the file must either contain two columns, named: ['age', 'rate'], to specify the incidence rates associated
     *  with each age group; or three columns, named: ['start_age', 'end_age', 'rate'], to specify the incidence rates
     *  associated with each age interval. The age ranges must fully cover the age intervals specified using parameters
     *  'applyAgeStart' and 'applyAgeIntervalLength'.
     * @param modelCompetingIncidenceRatesUrl
     *  A URL to a CSV file containing the age-specific incidence rates for competing events in the population of
     *  interest. The data in the file must either contain two columns, named: ['age', 'rate'], to specify the incidence
     *  rates associated with each age group; or three columns, named: ['start_age', 'end_age', 'rate'], to specify the
     *  incidence rates associated with each age interval. The age ranges must fully cover the age intervals specified
     *  using parameters 'applyAgeStart' and 'applyAgeIntervalLength'.
     * @param modelCovariateFormulaBeforeCutpointUrl
     *  A URL to a text file containing the covariate formula for the model to be fit before the cut-point. The text
     *  should contain a string description of the covariate formula using the Patsy symbolic description language.
     *  Reference: https://patsy.readthedocs.io/en/latest/formulas.html#the-formula-language
     * @param modelCovariateFormulaAfterCutpointUrl
     *  A URL to a text file containing the covariate formula for the model to be fit after the cut-point. The text
     *  should contain a string description of the covariate formula using the Patsy symbolic description language. If
     *  this value is undefined, the covariate formula before the cut-point is used.
     *  Reference: https://patsy.readthedocs.io/en/latest/formulas.html#the-formula-language
     * @param modelLogRelativeRiskBeforeCutpointUrl
     *  A URL to a JSON file containing the log odds ratios, of the variables in the model except the intercept term, in
     *  association with the disease, for the model to be fit before the cut-point. The JSON file should contain an
     *  object with the variable names as keys and the log odds ratios as values.
     * @param modelLogRelativeRiskAfterCutpointUrl
     *  A URL to a JSON file containing the log odds ratios, of the variables in the model except the intercept term,
     *  in association with the disease, for the model to be fit after the cut-point. The JSON file should contain an
     *  object with the variable names as keys and the log odds ratios as values. If this value is undefined, the
     *  log odds ratios before the cut-point are used.
     * @param modelReferenceDatasetBeforeCutpointUrl
     *  A URL to a CSV file containing the reference dataset with risk factor distribution that is representative of
     *  the population of interest before the cut-point.
     * @param modelReferenceDatasetAfterCutpointUrl
     *  A URL to a CSV file containing the reference dataset with risk factor distribution that is representative of
     *  the population of interest after the cut-point. If this value is undefined, the reference dataset before the
     *  cut-point is used.
     * @param modelReferenceDatasetWeightsVariableNameBeforeCutpoint
     *  A string specifying the name of the variable in the dataset at 'modelReferenceDatasetBeforeCutpointUrl' that
     *  contains the sampling weights for each individual.
     * @param modelReferenceDatasetWeightsVariableNameAfterCutpoint
     *  A string specifying the name of the variable in the dataset at 'modelReferenceDatasetAfterCutpointUrl' that
     *  contains the sampling weights for each individual. If this value is undefined, the weights variable name before
     *  the cut-point is used.
     * @param modelSnpInfoUrl
     *  A URL to a CSV file containing the information about the SNPs in the model. The data should contain three
     *  columns, named: ['snp_name', 'snp_odds_ratio', 'snp_freq'] corresponding to the SNP ID, the odds ratio of the
     *  SNP in association with the disease, and the minor allele frequency, respectively.
     * @param modelFamilyHistoryVariableNameBeforeCutpoint
     *  A string specifying the name of the binary variable (values: {0, 1}; missing values are permitted) in the
     *  dataset at 'modelReferenceDatasetBeforeCutpointUrl' that indicates whether the individual has a family history
     *  of the disease.
     * @param modelFamilyHistoryVariableNameAfterCutpoint
     *  A string specifying the name of the binary variable (values: {0, 1}; missing values are permitted) in the
     *  dataset at 'modelReferenceDatasetWeightsVariableNameAfterCutpoint' that indicates whether the individual has a
     *  family history of the disease. If this value is set to None, the family history variable name before the
     *  cut-point is used.
     * @param applyCovariateProfileBeforeCutpointUrl
     *  A URL to a CSV file containing the covariate (risk factor) profiles of the individuals for whom the absolute
     *  risk is to be computed before the cut-point.
     * @param applyCovariateProfileAfterCutpointUrl
     *  A URL to a CSV file containing the covariate (risk factor) profiles of the individuals for whom the absolute
     *  risk is to be computed after the cut-point. If this value is undefined, the covariate profile before the
     *  cut-point is used.
     * @param applySnpProfileUrl
     *  A URL to a CSV file containing the SNP profiles (values: {0: homozygous reference alleles, 1: heterozygous,
     *  2: homozygous alternate alleles}) of the individuals for whom the absolute risk is to be computed. Missing
     *  values are permitted.
     * @param cutpoint
     *  Integer age using which the absolute risk computation is split into before and after the cut-point. If a single
     *  integer is provided, all instances in the profiles ('applyCovariateProfileUrl' and/or 'applySnpProfileUrl') are
     *  assigned this cut-point. If a different cut-point needs to be assigned for each instance, provide an array of
     *  cut-points as integers of the same length as the number of instances in these profiles. If an array is provided,
     *  the parameters 'applyAgeStart' and 'applyAgeIntervalLength' must also be arrays of the same length.
     * @param numImputations
     *  The number of imputations for handling missing SNPs.
     * @param returnLinearPredictors
     *  Set true to return the calculated linear predictor values for each individual in the  'applyCovariateProfileUrl'
     *  and/or 'applySnpProfileUrl' datasets.
     * @param returnReferenceRisks
     *  Set true to return the absolute risk estimates for each individual in the 'modelReferenceDatasetUrl' dataset.
     * @param seed
     *  Fix a seed for reproducibility.
     * @returns {Promise<{}|*>}
     *  An object with the following keys—
     *      1) 'model':
     *          An object containing the model parameters. It contains two further keys: 'before_cutpoint' and
     *          'after_cutpoint', each of which contains the model parameters before and after the cut-point,
     *          respectively.
     *      2) 'profile':
     *          A records-oriented JSON of the input profile data, the specified age intervals, cut-points, and the
     *          calculated absolute risk estimates. If 'returnLinearPredictors' is set to true, they are also included
     *          as an additional column.
     *      3) 'reference_risks':
     *          If 'returnReferenceRisks' is True, this key will be present in the returned dictionary. It will contain
     *          two arrays of objects with keys 'before_cutpoint' and 'after_cutpoint', each of which contains the
     *          reference risks for before and after the cut-point datasets, respectively. Each of these arrays
     *          contains objects, one per unique combination of the specified age intervals, containing age at the start
     *          of interval ('age_interval_start'), age at the end of interval ('age_interval_end'), and a list absolute
     *          risk estimates for the individuals in the reference dataset ('population_risks').
     *      4) 'method':
     *          A string containing the name of the method used to calculate the absolute risk estimates. When this
     *          method is used, the method name is "iCARE - absolute risk with split intervals".
     */
    async computeAbsoluteRiskSplitInterval(
        {
            applyAgeStart,
            applyAgeIntervalLength,
            modelDiseaseIncidenceRatesUrl,
            modelCompetingIncidenceRatesUrl,
            modelCovariateFormulaBeforeCutpointUrl,
            modelCovariateFormulaAfterCutpointUrl,
            modelLogRelativeRiskBeforeCutpointUrl,
            modelLogRelativeRiskAfterCutpointUrl,
            modelReferenceDatasetBeforeCutpointUrl,
            modelReferenceDatasetAfterCutpointUrl,
            modelReferenceDatasetWeightsVariableNameBeforeCutpoint,
            modelReferenceDatasetWeightsVariableNameAfterCutpoint,
            modelSnpInfoUrl,
            modelFamilyHistoryVariableNameBeforeCutpoint,
            modelFamilyHistoryVariableNameAfterCutpoint,
            applyCovariateProfileBeforeCutpointUrl,
            applyCovariateProfileAfterCutpointUrl,
            applySnpProfileUrl,
            cutpoint,
            numImputations = 5,
            returnLinearPredictors = false,
            returnReferenceRisks = false,
            seed = 1234,
        }) {
        if (!this.pyodide) {
            throw new Error('Please instantiate this class using the WasmICARE.initialize() method.');
        }

        const fileURLs = [
            modelDiseaseIncidenceRatesUrl,
            modelCompetingIncidenceRatesUrl,
            modelCovariateFormulaBeforeCutpointUrl,
            modelCovariateFormulaAfterCutpointUrl,
            modelLogRelativeRiskBeforeCutpointUrl,
            modelLogRelativeRiskAfterCutpointUrl,
            modelReferenceDatasetBeforeCutpointUrl,
            modelReferenceDatasetAfterCutpointUrl,
            modelSnpInfoUrl,
            applyCovariateProfileBeforeCutpointUrl,
            applyCovariateProfileAfterCutpointUrl,
            applySnpProfileUrl,
        ].filter(url => url !== undefined);

        await this.fetchFilesAndWriteToPyodideFS(fileURLs);

        applyAgeStart = this._valueOrNone(applyAgeStart);
        applyAgeIntervalLength = this._valueOrNone(applyAgeIntervalLength);
        modelDiseaseIncidenceRatesUrl = this._getFileNameOrNone(modelDiseaseIncidenceRatesUrl);
        modelCompetingIncidenceRatesUrl = this._getFileNameOrNone(modelCompetingIncidenceRatesUrl);
        modelCovariateFormulaBeforeCutpointUrl = this._getFileNameOrNone(modelCovariateFormulaBeforeCutpointUrl);
        modelCovariateFormulaAfterCutpointUrl = this._getFileNameOrNone(modelCovariateFormulaAfterCutpointUrl);
        modelLogRelativeRiskBeforeCutpointUrl = this._getFileNameOrNone(modelLogRelativeRiskBeforeCutpointUrl);
        modelLogRelativeRiskAfterCutpointUrl = this._getFileNameOrNone(modelLogRelativeRiskAfterCutpointUrl);
        modelReferenceDatasetBeforeCutpointUrl = this._getFileNameOrNone(modelReferenceDatasetBeforeCutpointUrl);
        modelReferenceDatasetAfterCutpointUrl = this._getFileNameOrNone(modelReferenceDatasetAfterCutpointUrl);
        modelReferenceDatasetWeightsVariableNameBeforeCutpoint = this._valueOrNone(modelReferenceDatasetWeightsVariableNameBeforeCutpoint);
        modelReferenceDatasetWeightsVariableNameAfterCutpoint = this._valueOrNone(modelReferenceDatasetWeightsVariableNameAfterCutpoint);
        modelSnpInfoUrl = this._getFileNameOrNone(modelSnpInfoUrl);
        modelFamilyHistoryVariableNameBeforeCutpoint = this._valueOrNone(modelFamilyHistoryVariableNameBeforeCutpoint);
        modelFamilyHistoryVariableNameAfterCutpoint = this._valueOrNone(modelFamilyHistoryVariableNameAfterCutpoint);
        applyCovariateProfileBeforeCutpointUrl = this._getFileNameOrNone(applyCovariateProfileBeforeCutpointUrl);
        applyCovariateProfileAfterCutpointUrl = this._getFileNameOrNone(applyCovariateProfileAfterCutpointUrl);
        applySnpProfileUrl = this._getFileNameOrNone(applySnpProfileUrl);
        cutpoint = this._valueOrNone(cutpoint);
        numImputations = this._valueOrNone(numImputations);
        returnLinearPredictors = returnLinearPredictors ? 'True' : 'False';
        returnReferenceRisks = returnReferenceRisks ? 'True' : 'False';
        seed = this._valueOrNone(seed);

        let result = this.pyodide.runPython(`
result = icare.compute_absolute_risk_split_interval(
        apply_age_start = ${applyAgeStart},
        apply_age_interval_length = ${applyAgeIntervalLength},
        model_disease_incidence_rates_path = ${modelDiseaseIncidenceRatesUrl},
        model_competing_incidence_rates_path = ${modelCompetingIncidenceRatesUrl},
        model_covariate_formula_before_cutpoint_path = ${modelCovariateFormulaBeforeCutpointUrl},
        model_covariate_formula_after_cutpoint_path = ${modelCovariateFormulaAfterCutpointUrl},
        model_log_relative_risk_before_cutpoint_path = ${modelLogRelativeRiskBeforeCutpointUrl},
        model_log_relative_risk_after_cutpoint_path = ${modelLogRelativeRiskAfterCutpointUrl},
        model_reference_dataset_before_cutpoint_path = ${modelReferenceDatasetBeforeCutpointUrl},
        model_reference_dataset_after_cutpoint_path = ${modelReferenceDatasetAfterCutpointUrl},
        model_reference_dataset_weights_variable_name_before_cutpoint = ${modelReferenceDatasetWeightsVariableNameBeforeCutpoint},
        model_reference_dataset_weights_variable_name_after_cutpoint = ${modelReferenceDatasetWeightsVariableNameAfterCutpoint},
        model_snp_info_path = ${modelSnpInfoUrl},
        model_family_history_variable_name_before_cutpoint = ${modelFamilyHistoryVariableNameBeforeCutpoint},
        model_family_history_variable_name_after_cutpoint = ${modelFamilyHistoryVariableNameAfterCutpoint},
        apply_covariate_profile_before_cutpoint_path= ${applyCovariateProfileBeforeCutpointUrl},
        apply_covariate_profile_after_cutpoint_path = ${applyCovariateProfileAfterCutpointUrl},
        apply_snp_profile_path = ${applySnpProfileUrl},
        cutpoint = ${cutpoint},
        num_imputations = ${numImputations},
        return_linear_predictors = ${returnLinearPredictors},
        return_reference_risks = ${returnReferenceRisks},
        seed = ${seed})

result
`).toJs();

        if (result.isError) {
            throw new Error(result.message);
        }

        result = this.convertOutputToJSON(result);
        result['profile'] = JSON.parse(result['profile']);

        return result;
    }

    /**
     * This function is used to validate absolute risk models.
     * @async
     * @function
     * @param studyDataUrl
     *  A URL to a CSV file containing the study data. The data must contain the following columns:
     *      1) 'observed_outcome': the disease status { 0: censored; 1: disease occurred by the end of the follow-up
     *          period },
     *      2) 'study_entry_age': age (in years) when entering the cohort,
     *      3) 'study_exit_age': age (in years) at last follow-up visit,
     *      4) 'time_of_onset': time (in years) from study entry to disease onset; note that all subjects are
     *         disease-free at the time of entry and those individuals who do not develop the disease by the end of the
     *         follow-up period are considered censored, and this value is set to 'inf'.
     *      5) 'sampling_weights': for a case-control study nested within a cohort study, this is column is provided to
     *         indicate the probability of the inclusion of that individual into the nested case-control study. If the
     *         study is not a nested case-control study, do not include this column in the study data.
     * @param predictedRiskInterval
     *  If the risk validation is to be performed over the total follow-up period, set this parameter to the string
     *  'total-followup'. Otherwise, it should be set to either an integer or an array of integers representing the
     *  number of years after study entry over which, the estimated risk is being validated. Example: 5 for a 5-year
     *  risk validation.
     * @param icareModelParameters
     *  An object containing the parameters of the absolute risk model to be validated. The keys of the object
     *  are the parameters of the 'computeAbsoluteRisk' function. If the risk prediction being validated is from a
     *  method other than iCARE, this parameter should be set to null and the 'predictedRiskVariableName' and
     *  'linearPredictorVariableName' parameters should be set to the names of the columns containing the risk
     *  predictions and linear predictor values, respectively, in the study data.
     * @param predictedRiskVariableName
     *  If the risk prediction is to be done by iCARE (i.e. using the computeAbsoluteRisk() method), set this value
     *  to null. Else, supply the risk predictions for each individual in the study data, using some other method,
     *  as an additional column in the study data. The name of that column should be supplied here as a string.
     * @param linearPredictorVariableName
     *  The linear predictor is a risk score for an individual calculated as: Z * beta. Here, Z is a vector of risk
     *  factor values for that individual and beta is a vector of log relative risks. If the linear predictor values are
     *  to be calculated by iCARE (i.e. using the compute_absolute_risk() method), set this value to null. Else, supply
     *  the linear predictor values for each individual in the study data as an additional column in the study data.
     *  The name of that column should be supplied here.
     * @param referenceEntryAge
     *  Specify an integer or an array of integers, representing the ages at entry for the reference population, to
     *  compute their absolute risks. If both 'referencePredictedRisks' and 'referenceLinearPredictors' are  provided,
     *  this parameter is ignored.
     * @param referenceExitAge
     *  Specify an integer or an array of integers, representing the ages at exit for the reference population, to
     *  compute their absolute risks. If both 'reference_predicted_risks' and 'reference_linear_predictors' are
     *  provided, this parameter is ignored.
     * @param referencePredictedRisks
     *  An array of absolute risk estimates for the reference population assuming the entry ages specified at
     *  'referenceEntryAge' and exit ages specified at 'referenceExitAge'. If both this parameter and
     *  'referenceLinearPredictors' are provided, they are not re-computed using the computeAbsoluteRisk() method.
     * @param referenceLinearPredictors
     *  An array of linear predictor values for the reference population assuming the entry ages specified at
     *  'referenceEntryAge' and exit ages specified at 'referenceExitAge'. If both this parameter and
     *  'referencePredictedRisks' are provided, they are not re-computed using the computeAbsoluteRisk() method.
     * @param numberOfPercentiles
     *  The number of percentiles of the risk score that determines the number of strata over which, the risk prediction
     *  model is to be validated.
     * @param linearPredictorCutoffs
     *  An array of user specified cut-points for the linear predictor to define categories for absolute risk
     *  calibration and relative risk calibration.
     * @param datasetName
     *  Name of the validation dataset, e.g., "PLCO full cohort" or "Full cohort simulation".
     * @param modelName
     *  Name of the absolute risk model being validated, e.g., "Synthetic model" or "Simulation setting".
     * @param seed
     *  Fix a seed for reproducibility.
     * @returns {Promise<{}|*>}
     *  An object with the following keys—
     *      1) 'info':
     *          An object with the following keys:
     *              - 'risk_prediction_interval': A string describing the risk prediction interval e.g., "5 years". If
     *                the risk prediction is over the total follow-up period of the study, this reads
     *                "Observed follow-up". If each individual is assigned a different risk prediction interval, this
     *                reads "Varies across individuals".
     *              - 'dataset_name': The name of the validation dataset.
     *              - 'model_name': The name of the absolute risk model being validated.
     *      2) 'study_data':
     *          A records-oriented JSON representation of the user-input study data. Additionally, the following columns
     *          are added to the study data:
     *              - 'predicted_risk_interval': The risk prediction interval for each individual in the study data
     *                based on the user-input parameter value for 'predictedRiskInterval'.
     *              - 'followup': The observed follow-up time for each individual in the study data after censoring and
     *                based on the user-input parameter value for 'predictedRiskInterval'.
     *              - 'risk_estimates': The estimated absolute risks for each individual in the study data based on the
     *                model specified by the user-input parameters. This column is only present when the
     *                'predictedRiskVariableName' parameter is set to null.
     *              - 'linear_predictors': The estimated linear predictors for each individual in the study data based
     *                on the model specified by the user-input parameters. This column is only present when the
     *                'linearPredictorVariableName' parameter is set to null.
     *              - 'linear_predictors_category': The category of the linear predictor for each individual in the
     *                study data based on the user-input parameter value for 'linearPredictorCutoffs', if provided, else
     *                based on 'numberOfPercentiles'.
     *      3) 'reference':
     *          An object with two further keys: 'absolute_risk' and 'risk_score' containing the predicted absolute
     *          risks and linear predictors for the reference population, respectively. This key is only present when
     *          either both 'referenceEntryAge' and 'referenceExitAge' are provided to be calculated by iCARE, or
     *          pre-calculated 'referencePredictedRisks' and 'referenceLinearPredictors' are both directly provided by
     *          the user.
     *      4) 'incidence_rates':
     *          The estimated age-specific incidence rates in the study and population as a data frame converted into
     *          the records-oriented JSON format. The columns of the data frame are "age" and "study_rate". When iCARE
     *          parameters are included (containing the disease incidence rates), "population_rate" is also included as
     *          a column.
     *      5) 'auc':
     *          An object containing the area under the receiver operating characteristic curve (AUC), the variance,
     *          and the 95% confidence interval for the AUC. The object has the following keys: 'auc', 'variance',
     *          'lower_ci', and 'upper_ci'.
     *      6) 'expected_by_observed_ratio':
     *          An object containing the ratio of the expected and the observed number of cases in the study population,
     *          and the 95% confidence interval for the ratio. The dictionary has the following keys: 'ratio',
     *          'lower_ci', and 'upper_ci'.
     *      7) 'calibration':
     *          An object containing the calibration results. The dictionary has the following keys: 'absolute_risk',
     *          and 'relative_risk' containing the calibration results for absolute risk and relative risk,
     *          respectively. Each of these keys is a dictionary with the following information (associated key name):
     *          statistical testing method name ('method'), p-value ('p_value'), variance matrix ('variance'),
     *          test-statistic ('statistic'; with a sub-key containing 'chi_square' for the chi-squared metric), and
     *          parameters of the statistical test ('parameter'; with a sub-key 'degrees_of_freedom' for the degrees of
     *          freedom of the chi-squared distribution).
     *      8) 'category_specific_calibration':
     *          A records-oriented JSON containing the category-specific calibration results. The columns of the data
     *          frame are: 'category', 'observed_absolute_risk', 'predicted_absolute_risk', 'lower_ci_absolute_risk',
     *          'upper_ci_absolute_risk', 'observed_relative_risk', 'predicted_relative_risk', 'lower_ci_relative_risk',
     *          'upper_ci_relative_risk'. The rows of the data frame are the categories of the risk score.
     *      9) 'method':
     *          A string containing the name of the iCARE method being used. When this method is used, the method name
     *          is "iCARE - absolute risk model validation".
     */
    async validateAbsoluteRiskModel(
        {
            studyDataUrl,
            predictedRiskInterval,
            icareModelParameters = {
                applyAgeStart: undefined,
                applyAgeIntervalLength: undefined,
                modelDiseaseIncidenceRatesUrl: undefined,
                modelCompetingIncidenceRatesUrl: undefined,
                modelCovariateFormulaUrl: undefined,
                modelLogRelativeRiskUrl: undefined,
                modelReferenceDatasetUrl: undefined,
                modelReferenceDatasetWeightsVariableName: undefined,
                modelSnpInfoUrl: undefined,
                modelFamilyHistoryVariableName: undefined,
                numImputations: 5,
                applyCovariateProfileUrl: undefined,
                applySnpProfileUrl: undefined,
                returnLinearPredictors: false,
                returnReferenceRisks: false,
                seed: 1234,
            },
            predictedRiskVariableName,
            linearPredictorVariableName,
            referenceEntryAge,
            referenceExitAge,
            referencePredictedRisks,
            referenceLinearPredictors,
            numberOfPercentiles = 10,
            linearPredictorCutoffs,
            datasetName = 'Example dataset',
            modelName = 'Example risk prediction model',
            seed = 1234,
        }) {
        if (!this.pyodide) {
            throw new Error('Please instantiate this class using the WasmICARE.initialize() method.');
        }

        icareModelParameters = Object.assign({
            applyAgeStart: undefined,
            applyAgeIntervalLength: undefined,
            modelDiseaseIncidenceRatesUrl: undefined,
            modelCompetingIncidenceRatesUrl: undefined,
            modelCovariateFormulaUrl: undefined,
            modelLogRelativeRiskUrl: undefined,
            modelReferenceDatasetUrl: undefined,
            modelReferenceDatasetWeightsVariableName: undefined,
            modelSnpInfoUrl: undefined,
            modelFamilyHistoryVariableName: undefined,
            numImputations: 5,
            applyCovariateProfileUrl: undefined,
            applySnpProfileUrl: undefined,
            returnLinearPredictors: false,
            returnReferenceRisks: false,
            seed: 1234,
        }, icareModelParameters);

        if (icareModelParameters) {
            const fileURLs = [
                icareModelParameters.modelDiseaseIncidenceRatesUrl,
                icareModelParameters.modelCompetingIncidenceRatesUrl,
                icareModelParameters.modelCovariateFormulaUrl,
                icareModelParameters.modelLogRelativeRiskUrl,
                icareModelParameters.modelReferenceDatasetUrl,
                icareModelParameters.modelSnpInfoUrl,
                icareModelParameters.applyCovariateProfileUrl,
                icareModelParameters.applySnpProfileUrl,
            ].filter(url => url !== undefined);

            await this.fetchFilesAndWriteToPyodideFS(fileURLs);

            icareModelParameters.applyAgeStart = this._valueOrNone(icareModelParameters.applyAgeStart);
            icareModelParameters.applyAgeIntervalLength = this._valueOrNone(icareModelParameters.applyAgeIntervalLength);
            icareModelParameters.modelDiseaseIncidenceRatesUrl = this._getFileNameOrNone(icareModelParameters.modelDiseaseIncidenceRatesUrl);
            icareModelParameters.modelCompetingIncidenceRatesUrl = this._getFileNameOrNone(icareModelParameters.modelCompetingIncidenceRatesUrl);
            icareModelParameters.modelCovariateFormulaUrl = this._getFileNameOrNone(icareModelParameters.modelCovariateFormulaUrl);
            icareModelParameters.modelLogRelativeRiskUrl = this._getFileNameOrNone(icareModelParameters.modelLogRelativeRiskUrl);
            icareModelParameters.modelReferenceDatasetUrl = this._getFileNameOrNone(icareModelParameters.modelReferenceDatasetUrl);
            icareModelParameters.modelReferenceDatasetWeightsVariableName = this._valueOrNone(icareModelParameters.modelReferenceDatasetWeightsVariableName);
            icareModelParameters.modelSnpInfoUrl = this._getFileNameOrNone(icareModelParameters.modelSnpInfoUrl);
            icareModelParameters.modelFamilyHistoryVariableName = this._valueOrNone(icareModelParameters.modelFamilyHistoryVariableName);
            icareModelParameters.numImputations = this._valueOrNone(icareModelParameters.numImputations);
            icareModelParameters.applyCovariateProfileUrl = this._getFileNameOrNone(icareModelParameters.applyCovariateProfileUrl);
            icareModelParameters.applySnpProfileUrl = this._getFileNameOrNone(icareModelParameters.applySnpProfileUrl);
            icareModelParameters.returnLinearPredictors = icareModelParameters.returnLinearPredictors ? 'True' : 'False';
            icareModelParameters.returnReferenceRisks = icareModelParameters.returnReferenceRisks ? 'True' : 'False';
            icareModelParameters.seed = this._valueOrNone(icareModelParameters.seed);

            icareModelParameters = `{
  'apply_age_start': ${icareModelParameters.applyAgeStart},
  'apply_age_interval_length': ${icareModelParameters.applyAgeIntervalLength},
  'model_disease_incidence_rates_path': ${icareModelParameters.modelDiseaseIncidenceRatesUrl},
  'model_competing_incidence_rates_path': ${icareModelParameters.modelCompetingIncidenceRatesUrl},
  'model_covariate_formula_path': ${icareModelParameters.modelCovariateFormulaUrl},
  'model_log_relative_risk_path': ${icareModelParameters.modelLogRelativeRiskUrl},
  'model_reference_dataset_path': ${icareModelParameters.modelReferenceDatasetUrl},
  'model_reference_dataset_weights_variable_name': ${icareModelParameters.modelReferenceDatasetWeightsVariableName},
  'model_snp_info_path': ${icareModelParameters.modelSnpInfoUrl},
  'model_family_history_variable_name': ${icareModelParameters.modelFamilyHistoryVariableName},
  'num_imputations': ${icareModelParameters.numImputations},
  'apply_covariate_profile_path': ${icareModelParameters.applyCovariateProfileUrl},
  'apply_snp_profile_path': ${icareModelParameters.applySnpProfileUrl},
  'return_linear_predictors': ${icareModelParameters.returnLinearPredictors},
  'return_reference_risks': ${icareModelParameters.returnReferenceRisks},
  'seed': ${icareModelParameters.seed}}`;
        } else {
            icareModelParameters = 'None'
        }

        const fileURLs = [studyDataUrl].filter(url => url !== undefined);

        await this.fetchFilesAndWriteToPyodideFS(fileURLs);

        studyDataUrl = this._getFileNameOrNone(studyDataUrl);
        predictedRiskInterval = this._valueOrNone(predictedRiskInterval);
        predictedRiskVariableName = this._valueOrNone(predictedRiskVariableName);
        linearPredictorVariableName = this._valueOrNone(linearPredictorVariableName);
        referenceEntryAge = this._valueOrNone(referenceEntryAge);
        referenceExitAge = this._valueOrNone(referenceExitAge);
        referencePredictedRisks = this._valueOrNone(referencePredictedRisks);
        referenceLinearPredictors = this._valueOrNone(referenceLinearPredictors);
        numberOfPercentiles = this._valueOrNone(numberOfPercentiles);
        linearPredictorCutoffs = this._valueOrNone(linearPredictorCutoffs);
        datasetName = this._valueOrNone(datasetName);
        modelName = this._valueOrNone(modelName);
        seed = this._valueOrNone(seed);

        let result = this.pyodide.runPython(`
result = icare.validate_absolute_risk_model(
        study_data_path = ${studyDataUrl},
        predicted_risk_interval = ${predictedRiskInterval},
        icare_model_parameters = ${icareModelParameters},
        predicted_risk_variable_name = ${predictedRiskVariableName},
        linear_predictor_variable_name = ${linearPredictorVariableName},
        reference_entry_age = ${referenceEntryAge},
        reference_exit_age = ${referenceExitAge},
        reference_predicted_risks = ${referencePredictedRisks},
        reference_linear_predictors = ${referenceLinearPredictors},
        number_of_percentiles = ${numberOfPercentiles},
        linear_predictor_cutoffs = ${linearPredictorCutoffs},
        dataset_name = ${datasetName},
        model_name = ${modelName},
        seed = ${seed})

result
`).toJs();

        if (result.isError) {
            throw new Error(result.message);
        }

        result = this.convertOutputToJSON(result);
        result['study_data'] = JSON.parse(result['study_data']);
        result['incidence_rates'] = JSON.parse(result['incidence_rates']);
        result['category_specific_calibration'] = JSON.parse(result['category_specific_calibration']);

        return result;
    }
}

/**
 * Function to load Wasm-iCARE. The returned class instance has all the functionalities of Py-iCARE.
 * @async
 * @function
 * @returns {Promise<WasmICARE>}
 */
async function loadWasmICARE() {
    return await WasmICARE.initialize();
}

export {
    loadWasmICARE
};